import { TaskRole, UserRole } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";

const PRIVILEGED_ROLES: UserRole[] = ["super_admin", "group_admin", "supervisor"];
const TRANSLATION_OPEN_STATUSES = [
  "claimable",
  "assigned",
  "in_progress",
  "submitted",
  "review_approved",
] as const;
const RESERVED_CLAIM_STATUSES = ["pending", "active", "submitted", "approved"] as const;

function parseWorkflowEntries(value: string | null | undefined): Array<Record<string, unknown>> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      );
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, config]) => Boolean(config) && typeof config === "object" && !Array.isArray(config))
        .map(([role, config]) => ({ ...(config as Record<string, unknown>), role }));
    }
  } catch {
    return [];
  }
  return [];
}

function requiredTagIdsForRole(
  role: TaskRole,
  workflowConfig: string | null,
  templateRoles: string | null
): string[] {
  const entry = [
    ...parseWorkflowEntries(workflowConfig),
    ...parseWorkflowEntries(templateRoles),
  ].find((candidate) => candidate.role === role);
  const value = entry?.requiredTagIds ?? entry?.required_tag_ids;
  return Array.isArray(value)
    ? value.filter((tagId): tagId is string => typeof tagId === "string")
    : [];
}

function translationHasOpenCoverage(task: {
  status: string;
  unit: { episode_length: number | null } | null;
  claims: Array<{ segment_start: number; segment_end: number }>;
}): boolean {
  if (task.status === "claimable") return true;
  const episodeLength = task.unit?.episode_length;
  if (!episodeLength) return false;

  const covered = [...task.claims]
    .sort((a, b) => a.segment_start - b.segment_start)
    .reduce(
      (state, claim) => ({
        covered:
          state.covered +
          (claim.segment_start <= state.lastEnd
            ? Math.max(0, claim.segment_end - state.lastEnd)
            : Math.max(0, claim.segment_end - claim.segment_start)),
        lastEnd: Math.max(state.lastEnd, claim.segment_end),
      }),
      { covered: 0, lastEnd: 0 }
    ).covered;

  return covered < episodeLength;
}

export async function getEligibleOpenClaimRoles(
  projectId: string,
  userId: string
): Promise<TaskRole[]> {
  const [project, approvedTags, roleTags] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        is_archived: true,
        deleted_at: true,
        workflow_config: true,
        template: { select: { roles: true } },
        tasks: {
          where: {
            OR: [
              { status: "claimable" },
              { role: "translation", status: { in: [...TRANSLATION_OPEN_STATUSES] } },
            ],
          },
          select: {
            role: true,
            status: true,
            unit: { select: { episode_length: true } },
            claims: {
              where: { status: { in: [...RESERVED_CLAIM_STATUSES] } },
              select: { segment_start: true, segment_end: true },
            },
          },
        },
      },
    }),
    prisma.tagApplication.findMany({
      where: { user_id: userId, approved: true },
      select: { tag_id: true, tag: { select: { role_type: true } } },
    }),
    prisma.roleTag.findMany({
      select: { role_type: true },
    }),
  ]);

  if (!project || project.deleted_at || project.is_archived) return [];

  const approvedTagIds = new Set(approvedTags.map((application) => application.tag_id));
  const approvedRoleTypes = new Set(approvedTags.map((application) => application.tag.role_type));
  const configuredRoleTypes = new Set(roleTags.map((tag) => tag.role_type));
  const eligibleRoles = new Set<TaskRole>();

  for (const task of project.tasks) {
    if (
      task.role === "translation" &&
      !translationHasOpenCoverage(task)
    ) {
      continue;
    }

    const requiredTagIds = requiredTagIdsForRole(
      task.role,
      project.workflow_config,
      project.template?.roles ?? null
    );
    const hasRequiredTag = requiredTagIds.length > 0
      ? requiredTagIds.some((tagId) => approvedTagIds.has(tagId))
      : !configuredRoleTypes.has(task.role) || approvedRoleTypes.has(task.role);

    if (hasRequiredTag) eligibleRoles.add(task.role);
  }

  return [...eligibleRoles];
}

export async function hasProjectViewPermission(
  projectId: string,
  userId: string,
  userRole: UserRole,
  options: { allowOpenClaimCandidate?: boolean } = { allowOpenClaimCandidate: true }
): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      owner_id: true,
      members: {
        where: { user_id: userId, left_at: null },
        select: { id: true },
        take: 1,
      },
      tasks: {
        where: { assignee_id: userId },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }
  if (PRIVILEGED_ROLES.includes(userRole)) return true;
  if (project.owner_id === userId || project.members.length > 0 || project.tasks.length > 0) return true;
  if (options.allowOpenClaimCandidate === false) return false;

  return (await getEligibleOpenClaimRoles(projectId, userId)).length > 0;
}

export async function assertProjectViewPermission(
  projectId: string,
  userId: string,
  userRole: UserRole,
  options?: { allowOpenClaimCandidate?: boolean }
): Promise<void> {
  if (!projectId) {
    throw new AppError("Insufficient permissions to view this project", "FORBIDDEN", 403);
  }
  if (!(await hasProjectViewPermission(projectId, userId, userRole, options))) {
    throw new AppError("Insufficient permissions to view this project", "FORBIDDEN", 403);
  }
}
