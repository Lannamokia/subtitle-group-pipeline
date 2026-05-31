import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { TaskStatus, TimelineEventType } from "@prisma/client";
import * as auditService from "../audit/audit.service";
import * as timelineService from "../timeline/timeline.service";
import * as notificationService from "../notification/notification.service";
import { permanentlyDeleteProjectById } from "../../jobs/recyclebin.cleanup";
import { normalizeUploadPolicyJson } from "../../utils/uploadPolicy";
import type {
  CreateProjectInput,
  CreateProjectFromTemplateInput,
  UpdateProjectInput,
  AddMemberInput,
  UpdateMemberInput,
  CreateUnitInput,
  UpdateProjectUnitsInput,
  JoinRequestInput,
  ProjectQueryInput,
  UpdateJoinRequestInput,
} from "./project.schema";

const UNIT_DELETE_ACTIVE_TASK_STATUSES: TaskStatus[] = [
  "assigned",
  "in_progress",
  "submitted",
  "review_approved",
  "review_rejected",
  "completed",
  "overdue",
  "frozen",
];

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseOptionalJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  return parseJsonObject(value);
}

function parseOptionalJsonArray(value: string | null | undefined): Array<Record<string, unknown>> {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
      : [];
  } catch {
    return [];
  }
}

function workflowEntriesFromConfig(value: string | null | undefined): Array<Record<string, unknown>> {
  const arrayEntries = parseOptionalJsonArray(value);
  if (arrayEntries.length > 0) {
    return arrayEntries.map((entry) => ({ ...entry }));
  }

  const objectConfig = parseOptionalJsonObject(value);
  return Object.entries(objectConfig)
    .filter(([, config]) => config && typeof config === "object" && !Array.isArray(config))
    .map(([role, config]) => ({
      ...(config as Record<string, unknown>),
      role: (config as Record<string, unknown>).role ?? role,
    }));
}

function setRoleMaxSegmentLength(
  workflowConfig: string | null | undefined,
  role: string,
  value: number | null
): string | null {
  const entries = workflowEntriesFromConfig(workflowConfig);
  let roleEntry = entries.find((entry) => entry.role === role);

  if (!roleEntry && value === null && entries.length === 0) {
    return workflowConfig ?? null;
  }

  if (!roleEntry) {
    roleEntry = {
      role,
      enabled: true,
      assignmentStrategy: role === "translation" ? "open_claim" : "manual",
    };
    entries.push(roleEntry);
  }

  if (value === null) {
    delete roleEntry.maxSegmentLength;
    delete roleEntry.max_segment_length;
  } else {
    roleEntry.maxSegmentLength = value;
    delete roleEntry.max_segment_length;
  }

  return JSON.stringify(entries);
}

function metadataStringValue(metadata: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function isTaskBlockingUnitDeletion(task: {
  status: TaskStatus;
  assignee_id: string | null;
  started_at: Date | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  frozen_at: Date | null;
  _count: {
    claims: number;
    submissions: number;
    reviews: number;
    comments: number;
    notifications: number;
  };
}) {
  return Boolean(
    task.assignee_id ||
    UNIT_DELETE_ACTIVE_TASK_STATUSES.includes(task.status) ||
    task.started_at ||
    task.submitted_at ||
    task.completed_at ||
    task.cancelled_at ||
    task.frozen_at ||
    task._count.claims > 0 ||
    task._count.submissions > 0 ||
    task._count.reviews > 0 ||
    task._count.comments > 0 ||
    task._count.notifications > 0
  );
}

function numberFromPolicy(policy: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = policy[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

async function getProjectSupervisorRecipientIds(projectId: string, actorId?: string): Promise<string[]> {
  const [project, supervisors] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { owner_id: true },
    }),
    prisma.projectMember.findMany({
      where: {
        project_id: projectId,
        OR: [{ role: "supervisor" }, { is_lead: true }],
      },
      select: { user_id: true },
    }),
  ]);

  return [
    ...new Set([
      ...(project?.owner_id ? [project.owner_id] : []),
      ...supervisors.map((member) => member.user_id),
    ]),
  ].filter((userId) => userId !== actorId);
}

async function canManageProjectSettings(projectId: string, actorId?: string): Promise<boolean> {
  if (!actorId) {
    return false;
  }

  const [actor, project, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { owner_id: true },
    }),
    prisma.projectMember.findFirst({
      where: {
        project_id: projectId,
        user_id: actorId,
        left_at: null,
      },
      select: { role: true },
    }),
  ]);

  return Boolean(
    actor?.role === "super_admin" ||
      actor?.role === "group_admin" ||
      actor?.role === "supervisor" ||
      project?.owner_id === actorId ||
      membership?.role === "supervisor"
  );
}

function booleanFromPolicy(policy: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = policy[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function stringifyPolicyList(policy: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = policy[key];
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }
  }
  return null;
}

export async function createProject(
  ownerId: string,
  data: CreateProjectInput
) {
  const project = await prisma.project.create({
    data: {
      name: data.name,
      description: data.description,
      project_type: data.project_type,
      owner_id: ownerId,
      template_id: data.template_id,
      storage_backend_id: data.storage_backend_id,
      qq_group_id: data.qq_group_id,
      status: "draft",
    },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  // Auto-add owner as supervisor
  await prisma.projectMember.create({
    data: {
      project_id: project.id,
      user_id: ownerId,
      role: "supervisor",
      is_lead: true,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: project.id,
    event_type: TimelineEventType.project_created,
    title: "项目已创建",
    description: `项目「${project.name}」已创建`,
    actor_id: ownerId,
  });

  await auditService.log({
    user_id: ownerId,
    action: "project.create",
    resource_type: "project",
    resource_id: project.id,
    new_value: project,
  });

  return project;
}

export async function createProjectFromTemplate(
  ownerId: string,
  data: CreateProjectFromTemplateInput
) {
  const template = await prisma.projectTemplate.findUnique({
    where: { id: data.template_id },
  });

  if (!template) {
    throw new AppError("Template not found", "NOT_FOUND", 404);
  }

  const backend = await prisma.storageBackend.findUnique({
    where: { id: data.storage_backend_id },
  });
  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }
  if (!backend.is_active) {
    throw new AppError("Storage backend is not active", "BAD_REQUEST", 400);
  }
  const uploadPolicy = normalizeUploadPolicyJson(template.upload_policy);

  // Create project (inherit delivery checklist from template)
  const project = await prisma.project.create({
    data: {
      name: data.name,
      description: data.description,
      project_type: template.project_type,
      owner_id: ownerId,
      template_id: template.id,
      storage_backend_id: data.storage_backend_id,
      qq_group_id: data.qq_group_id,
      workflow_config: template.roles,
      upload_policy_config: uploadPolicy.json,
      notification_policy: template.notification_policy,
      ass_policy: template.ass_policy,
      product_config: template.product_config,
      delivery_checklist: template.delivery_checklist,
      release_task_type: template.release_task_type,
      status: "draft",
    },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  // Add owner as supervisor
  await prisma.projectMember.create({
    data: {
      project_id: project.id,
      user_id: ownerId,
      role: "supervisor",
      is_lead: true,
    },
  });

  await prisma.uploadPolicy.create({
    data: {
      project_id: project.id,
      allowed_types: uploadPolicy.json,
      max_size_bytes: numberFromPolicy(uploadPolicy.policy, "max_size_bytes", "maxSize") ?? 536870912000,
      require_approval: booleanFromPolicy(uploadPolicy.policy, "require_approval", "requireApproval") ?? false,
      extension_whitelist: stringifyPolicyList(uploadPolicy.policy, "extension_whitelist", "extensionWhitelist", "extensions"),
    },
  });

  for (let season = 1; season <= data.season_count; season++) {
    for (let unitNum = 1; unitNum <= data.units_per_season; unitNum++) {
      const unitTitle = season === 1 ? `Episode ${unitNum}` : `Season ${season} Episode ${unitNum}`;
      await prisma.projectUnit.create({
        data: {
          project_id: project.id,
          season_number: season,
          unit_number: unitNum,
          title: unitTitle,
          episode_length: data.episode_length,
        },
      });
    }
  }

  await timelineService.createTimelineEvent({
    project_id: project.id,
    event_type: TimelineEventType.project_created,
    title: "项目已从模板创建",
    description: `项目「${project.name}」已从模板「${template.name}」创建`,
    actor_id: ownerId,
    metadata: { template_id: template.id },
  });

  await auditService.log({
    user_id: ownerId,
    action: "project.create_from_template",
    resource_type: "project",
    resource_id: project.id,
    new_value: { project, template_id: template.id },
  });

  return project;
}

export async function getProjects(query: ProjectQueryInput, userId?: string) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (!query.include_deleted) {
    where.deleted_at = null;
  }

  if (!query.include_archived) {
    where.is_archived = false;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.project_type) {
    where.project_type = query.project_type;
  }

  if (query.supervisor_id) {
    where.members = {
      some: {
        user_id: query.supervisor_id,
        role: "supervisor",
      },
    };
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { description: { contains: query.search } },
    ];
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar_url: true,
          },
        },
        _count: {
          select: {
            members: true,
            tasks: true,
            units: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                nickname: true,
                avatar_url: true,
              },
            },
          },
        },
        tasks: {
          select: {
            id: true,
            assignee_id: true,
            role: true,
            status: true,
            unit: {
              select: {
                episode_length: true,
              },
            },
            claims: {
              select: {
                status: true,
                segment_start: true,
                segment_end: true,
              },
            },
          },
        },
      },
    }),
    prisma.project.count({ where }),
  ]);

  return {
    projects: projects.map(({ tasks, ...project }) => {
      const openClaimRoles = new Set<string>();
      for (const task of tasks) {
        if (task.status === "claimable") {
          openClaimRoles.add(task.role);
          continue;
        }
        if (
          task.role === "translation" &&
          ["assigned", "in_progress", "submitted"].includes(task.status)
        ) {
          const episodeLength = task.unit?.episode_length ?? null;
          if (!episodeLength) continue;
          const covered = task.claims
            .filter((claim) => ["pending", "active", "submitted", "approved"].includes(claim.status))
            .sort((a, b) => a.segment_start - b.segment_start)
            .reduce((state, claim) => {
              if (claim.segment_start <= state.lastEnd) {
                return {
                  covered: state.covered + Math.max(0, claim.segment_end - state.lastEnd),
                  lastEnd: Math.max(state.lastEnd, claim.segment_end),
                };
              }
              return {
                covered: state.covered + claim.segment_end - claim.segment_start,
                lastEnd: claim.segment_end,
              };
            }, { covered: 0, lastEnd: 0 }).covered;
          if (covered < episodeLength) {
            openClaimRoles.add(task.role);
          }
        }
      }

      return {
        ...project,
        assigned_user_ids: Array.from(
          new Set(
            tasks
              .map((task) => task.assignee_id)
              .filter((id): id is string => Boolean(id))
          )
        ),
        open_claim_roles: Array.from(openClaimRoles),
      };
    }),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getProjectById(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
      template: {
        select: {
          id: true,
          name: true,
          roles: true,
          upload_policy: true,
          product_config: true,
          notification_policy: true,
          ass_policy: true,
          delivery_checklist: true,
          release_task_type: true,
        },
      },
      storage_backend: {
        select: {
          id: true,
          name: true,
          backend_type: true,
        },
      },
      members: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar_url: true,
            },
          },
        },
      },
      units: {
        orderBy: [
          { season_number: "asc" },
          { unit_number: "asc" },
        ],
      },
      tasks: {
        include: {
          assignee: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar_url: true,
            },
          },
          dependencies: {
            include: {
              depends_on: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                },
              },
            },
          },
          claims: {
            where: { status: { in: ["pending", "active"] } },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  nickname: true,
                  avatar_url: true,
                },
              },
            },
            orderBy: { segment_start: "asc" },
          },
        },
        orderBy: { created_at: "asc" },
      },
      _count: {
        select: {
          tasks: true,
          files: true,
          units: true,
        },
      },
    },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  return project;
}

export async function updateProject(
  projectId: string,
  data: UpdateProjectInput,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (existing.deleted_at) {
    throw new AppError("Cannot update a deleted project", "BAD_REQUEST", 400);
  }

  if (!(await canManageProjectSettings(projectId, actorId))) {
    throw new AppError("Only project supervisors or administrators can update project settings", "FORBIDDEN", 403);
  }

  const updateData: Record<string, unknown> = {
    name: data.name,
    description: data.description,
    status: data.status,
    current_season: data.current_season,
    qq_group_id: data.qq_group_id,
  };
  if (data.delivery_checklist !== undefined) {
    updateData.delivery_checklist = JSON.stringify(data.delivery_checklist);
  }
  if (data.download_link_ttl_seconds !== undefined) {
    updateData.download_link_ttl_seconds = data.download_link_ttl_seconds;
  }
  if (data.wiki_approval_required !== undefined) {
    updateData.wiki_approval_required = data.wiki_approval_required;
  }
  if (data.translation_max_segment_length !== undefined) {
    updateData.workflow_config = setRoleMaxSegmentLength(
      existing.workflow_config,
      "translation",
      data.translation_max_segment_length
    );
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: updateData,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.update",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function archiveProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (existing.deleted_at) {
    throw new AppError("Cannot archive a deleted project", "BAD_REQUEST", 400);
  }

  if (existing.is_archived) {
    throw new AppError("Project is already archived", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      is_archived: true,
      archived_at: new Date(),
      status: "archived",
    },
  });

  // Freeze all active tasks
  await prisma.task.updateMany({
    where: {
      project_id: projectId,
      status: { in: ["in_progress", "submitted", "claimable", "assigned"] },
    },
    data: {
      status: "frozen",
      frozen_at: new Date(),
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_archived,
    title: "项目已归档",
    description: `项目「${project.name}」已归档`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.archive",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function unarchiveProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.is_archived) {
    throw new AppError("Project is not archived", "BAD_REQUEST", 400);
  }

  if (existing.deleted_at) {
    throw new AppError("Cannot unarchive a deleted project", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      is_archived: false,
      archived_at: null,
      status: "active",
    },
  });

  // Unfreeze tasks that were frozen during archive
  await prisma.task.updateMany({
    where: {
      project_id: projectId,
      status: "frozen",
    },
    data: {
      status: "claimable",
      frozen_at: null,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_unarchived,
    title: "项目已取消归档",
    description: `项目「${project.name}」已从归档恢复`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.unarchive",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function softDeleteProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.is_archived) {
    throw new AppError(
      "Project must be archived before it can be deleted",
      "BAD_REQUEST",
      400
    );
  }

  if (existing.deleted_at) {
    throw new AppError("Project is already deleted", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      deleted_at: new Date(),
      status: "deleted",
    },
  });

  // Create recycle bin record
  await prisma.recycleBinRecord.create({
    data: {
      user_id: actorId || existing.owner_id,
      resource_type: "project",
      resource_id: projectId,
      resource_data: JSON.stringify(existing),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_deleted,
    title: "项目已移入回收站",
    description: `项目「${project.name}」已移入回收站`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.soft_delete",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function restoreProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.deleted_at) {
    throw new AppError("Project is not in recycle bin", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      deleted_at: null,
      status: "archived",
      is_archived: true,
    },
  });

  // Mark recycle bin record as restored
  await prisma.recycleBinRecord.updateMany({
    where: {
      resource_type: "project",
      resource_id: projectId,
      restored_at: null,
    },
    data: {
      restored_at: new Date(),
      restored_by: actorId,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_restored,
    title: "项目已从回收站恢复",
    description: `项目「${project.name}」已从回收站恢复`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.restore",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function permanentlyDeleteProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.deleted_at) {
    throw new AppError("Project is not in recycle bin", "BAD_REQUEST", 400);
  }

  await auditService.log({
    user_id: actorId,
    action: "project.permanent_delete",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
  });

  await permanentlyDeleteProjectById(projectId);

  return { deleted: true, id: projectId };
}

export async function getProjectMembers(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  const members = await prisma.projectMember.findMany({
    where: { project_id: projectId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
    orderBy: { joined_at: "asc" },
  });

  return members;
}

export async function addMember(
  projectId: string,
  data: AddMemberInput,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot modify archived project", "BAD_REQUEST", 400);
  }

  const existing = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: data.user_id,
      },
    },
  });

  if (existing) {
    throw new AppError("User is already a member", "DUPLICATE_ERROR", 409);
  }

  const member = await prisma.projectMember.create({
    data: {
      project_id: projectId,
      user_id: data.user_id,
      role: data.role,
      is_lead: data.is_lead,
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.member_added,
    title: "Member added",
    description: `${member.user.nickname || member.user.username} joined as ${data.role}`,
    actor_id: actorId,
    metadata: { user_id: data.user_id, role: data.role },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.add_member",
    resource_type: "project",
    resource_id: projectId,
    new_value: member,
  });

  return member;
}

export async function removeMember(
  projectId: string,
  userId: string,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot modify archived project", "BAD_REQUEST", 400);
  }

  const member = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  if (!member) {
    throw new AppError("Member not found", "NOT_FOUND", 404);
  }

  // Unassign any tasks assigned to this member
  await prisma.task.updateMany({
    where: {
      project_id: projectId,
      assignee_id: userId,
    },
    data: {
      assignee_id: null,
      status: "claimable",
    },
  });

  await prisma.projectMember.delete({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.member_removed,
    title: "Member removed",
    description: `${member.user.nickname || member.user.username} was removed from the project`,
    actor_id: actorId,
    metadata: { user_id: userId },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.remove_member",
    resource_type: "project",
    resource_id: projectId,
    old_value: member,
  });

  return { success: true };
}

export async function updateMember(
  projectId: string,
  userId: string,
  data: UpdateMemberInput
) {
  const member = await prisma.projectMember.update({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
    data: {
      role: data.role,
      is_lead: data.is_lead,
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  return member;
}

export async function createUnit(
  projectId: string,
  data: CreateUnitInput,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  const unit = await prisma.projectUnit.create({
    data: {
      project_id: projectId,
      season_number: data.season_number,
      unit_number: data.unit_number,
      title: data.title,
      episode_length: data.episode_length,
      air_date: data.air_date ? new Date(data.air_date) : null,
      description: data.description,
    },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.create_unit",
    resource_type: "project",
    resource_id: projectId,
    new_value: unit,
  });

  return unit;
}

export async function updateProjectUnits(
  projectId: string,
  data: UpdateProjectUnitsInput,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot change units in archived project", "BAD_REQUEST", 400);
  }

  const existingUnits = await prisma.projectUnit.findMany({
    where: { project_id: projectId, season_number: data.season_number },
    orderBy: { unit_number: "asc" },
  });

  const currentUnitCount = existingUnits.length;
  const requestedDeleteIds = [...new Set(data.delete_unit_ids ?? [])];
  const requestedDeleteIdSet = new Set(requestedDeleteIds);
  let unitsToDelete: typeof existingUnits = [];

  if (data.units_per_season < currentUnitCount) {
    const deleteCount = currentUnitCount - data.units_per_season;

    if (requestedDeleteIds.length > 0) {
      if (requestedDeleteIds.length !== deleteCount) {
        throw new AppError(
          `Exactly ${deleteCount} episode(s) must be selected for deletion`,
          "VALIDATION_ERROR",
          400
        );
      }

      unitsToDelete = existingUnits.filter((unit) => requestedDeleteIdSet.has(unit.id));

      if (unitsToDelete.length !== requestedDeleteIds.length) {
        throw new AppError("One or more selected episodes do not belong to this project season", "VALIDATION_ERROR", 400);
      }
    } else {
      unitsToDelete = existingUnits.slice(-deleteCount);
    }
  } else if (requestedDeleteIds.length > 0) {
    throw new AppError("Episode deletion selection is only allowed when reducing episode count", "VALIDATION_ERROR", 400);
  }

  const unitIdsToDelete = unitsToDelete.map((unit) => unit.id);
  const tasksToDelete = unitIdsToDelete.length > 0
    ? await prisma.task.findMany({
        where: { unit_id: { in: unitIdsToDelete } },
        include: {
          _count: {
            select: {
              claims: true,
              submissions: true,
              reviews: true,
              comments: true,
              notifications: true,
            },
          },
        },
      })
    : [];

  const taskIdsToDelete = tasksToDelete.map((task) => task.id);
  const taskUnitMap = new Map(tasksToDelete.map((task) => [task.id, task.unit_id]));
  const [filesInProject, mergeJobs, conflicts, directClaims] = unitIdsToDelete.length > 0
    ? await Promise.all([
        prisma.fileEntity.findMany({
          where: {
            project_id: projectId,
            is_deleted: false,
          },
          select: {
            id: true,
            metadata: true,
          },
        }),
        prisma.mergeJob.findMany({
          where: {
            project_id: projectId,
            unit_id: { in: unitIdsToDelete },
          },
          select: { id: true, unit_id: true },
        }),
        prisma.subtitleConflict.findMany({
          where: {
            project_id: projectId,
            unit_id: { in: unitIdsToDelete },
          },
          select: { id: true, unit_id: true },
        }),
        prisma.translationClaim.findMany({
          where: {
            unit_id: { in: unitIdsToDelete },
          },
          select: { id: true, unit_id: true, task_id: true },
        }),
      ])
    : [[], [], [], []];

  const fileIdsToDelete: string[] = [];
  const fileUnitCounts = new Map<string, number>();
  for (const file of filesInProject) {
    const metadata = parseOptionalJsonObject(file.metadata);
    const unitId = metadataStringValue(metadata, "unit_id", "unitId");
    const taskId = metadataStringValue(metadata, "task_id", "taskId");
    const taskUnitId = taskId ? taskUnitMap.get(taskId) : undefined;
    const matchedUnitId = unitIdsToDelete.find((id) => id === unitId || id === taskUnitId);

    if (matchedUnitId) {
      fileIdsToDelete.push(file.id);
      fileUnitCounts.set(matchedUnitId, (fileUnitCounts.get(matchedUnitId) ?? 0) + 1);
    }
  }

  const directClaimIdsToDelete = directClaims
    .filter((claim) => claim.unit_id && unitIdsToDelete.includes(claim.unit_id))
    .map((claim) => claim.id);

  const deletionImpacts = unitsToDelete.map((unit) => {
    const unitTasks = tasksToDelete.filter((task) => task.unit_id === unit.id);
    const directUnitClaims = directClaims.filter((claim) => claim.unit_id === unit.id);
    const activeTaskCount = unitTasks.filter(isTaskBlockingUnitDeletion).length;
    const claimCount = directUnitClaims.length || unitTasks.reduce((sum, task) => sum + task._count.claims, 0);
    const submissionCount = unitTasks.reduce((sum, task) => sum + task._count.submissions, 0);
    const reviewCount = unitTasks.reduce((sum, task) => sum + task._count.reviews, 0);
    const commentCount = unitTasks.reduce((sum, task) => sum + task._count.comments, 0);
    const notificationCount = unitTasks.reduce((sum, task) => sum + task._count.notifications, 0);
    const fileCount = fileUnitCounts.get(unit.id) ?? 0;
    const mergeJobCount = mergeJobs.filter((job) => job.unit_id === unit.id).length;
    const conflictCount = conflicts.filter((conflict) => conflict.unit_id === unit.id).length;
    const isEmpty =
      activeTaskCount === 0 &&
      claimCount === 0 &&
      submissionCount === 0 &&
      reviewCount === 0 &&
      commentCount === 0 &&
      notificationCount === 0 &&
      fileCount === 0 &&
      mergeJobCount === 0 &&
      conflictCount === 0;

    return {
      unit_id: unit.id,
      season_number: unit.season_number,
      unit_number: unit.unit_number,
      title: unit.title,
      task_count: unitTasks.length,
      active_task_count: activeTaskCount,
      claim_count: claimCount,
      submission_count: submissionCount,
      review_count: reviewCount,
      comment_count: commentCount,
      notification_count: notificationCount,
      file_count: fileCount,
      merge_job_count: mergeJobCount,
      conflict_count: conflictCount,
      is_empty: isEmpty,
    };
  });

  const nonEmptyImpacts = deletionImpacts.filter((impact) => !impact.is_empty);

  if (nonEmptyImpacts.length > 0 && !data.force_delete_non_empty) {
    throw new AppError(
      "Selected episodes contain files or task work and require confirmation before deletion",
      "UNIT_NOT_EMPTY",
      409,
      { units: nonEmptyImpacts }
    );
  }

  const createdUnits: Array<{ id: string; season_number: number; unit_number: number; title: string | null }> = [];
  const remainingUnitNumbers = new Set(
    existingUnits
      .filter((unit) => !unitIdsToDelete.includes(unit.id))
      .map((unit) => unit.unit_number)
  );
  const remainingUnitCount = remainingUnitNumbers.size;
  const unitNumbersToCreate: number[] = [];
  for (
    let unitNumber = 1;
    remainingUnitCount + unitNumbersToCreate.length < data.units_per_season;
    unitNumber++
  ) {
    if (!remainingUnitNumbers.has(unitNumber)) {
      unitNumbersToCreate.push(unitNumber);
      remainingUnitNumbers.add(unitNumber);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (unitsToDelete.length > 0) {
      if (fileIdsToDelete.length > 0) {
        await tx.downloadLink.updateMany({
          where: {
            file_id: { in: fileIdsToDelete },
            is_active: true,
          },
          data: { is_active: false },
        });
        await tx.fileEntity.updateMany({
          where: { id: { in: fileIdsToDelete } },
          data: {
            is_deleted: true,
            deleted_at: new Date(),
            deleted_by: actorId,
          },
        });
      }

      if (taskIdsToDelete.length > 0) {
        await tx.notification.updateMany({
          where: { task_id: { in: taskIdsToDelete } },
          data: { task_id: null },
        });
        await tx.review.updateMany({
          where: { task_id: { in: taskIdsToDelete } },
          data: { task_id: null },
        });
      }

      if (directClaimIdsToDelete.length > 0) {
        await tx.translationSubmission.deleteMany({
          where: { claim_id: { in: directClaimIdsToDelete } },
        });
        await tx.translationClaim.deleteMany({
          where: { id: { in: directClaimIdsToDelete } },
        });
      }

      await tx.mergeJob.deleteMany({
        where: { unit_id: { in: unitIdsToDelete } },
      });
      await tx.subtitleConflict.deleteMany({
        where: { unit_id: { in: unitIdsToDelete } },
      });

      if (taskIdsToDelete.length > 0) {
        await tx.taskDependency.deleteMany({
          where: {
            OR: [
              { task_id: { in: taskIdsToDelete } },
              { depends_on_id: { in: taskIdsToDelete } },
            ],
          },
        });
        await tx.task.deleteMany({
          where: { id: { in: taskIdsToDelete } },
        });
      }
      await tx.projectUnit.deleteMany({
        where: { id: { in: unitIdsToDelete } },
      });
    }

    for (const unitNumber of unitNumbersToCreate) {
      const unitTitle =
        data.season_number === 1
          ? `Episode ${unitNumber}`
          : `Season ${data.season_number} Episode ${unitNumber}`;
      const unit = await tx.projectUnit.create({
        data: {
          project_id: projectId,
          season_number: data.season_number,
          unit_number: unitNumber,
          title: unitTitle,
          episode_length: data.episode_length ?? null,
        },
      });
      createdUnits.push(unit);
    }
  });

  if (data.episode_length !== undefined) {
    await prisma.projectUnit.updateMany({
      where: { project_id: projectId, season_number: data.season_number },
      data: { episode_length: data.episode_length },
    });
  }

  const units = await prisma.projectUnit.findMany({
    where: { project_id: projectId, season_number: data.season_number },
    orderBy: { unit_number: "asc" },
    include: { _count: { select: { tasks: true } } },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.custom,
    title: "分集数量已调整",
    description: `第 ${data.season_number} 季分集数量调整为 ${data.units_per_season} 集`,
    actor_id: actorId,
    metadata: {
      season_number: data.season_number,
      units_per_season: data.units_per_season,
      created_unit_numbers: createdUnits.map((unit) => unit.unit_number),
      deleted_unit_numbers: unitsToDelete.map((unit) => unit.unit_number),
      forced_delete: data.force_delete_non_empty ?? false,
    },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.update_units",
    resource_type: "project",
    resource_id: projectId,
    old_value: { units: existingUnits.map((unit) => unit.unit_number) },
    new_value: {
      units: units.map((unit) => unit.unit_number),
      deleted_units: deletionImpacts,
    },
  });

  return units;
}

export async function createJoinRequest(
  projectId: string,
  userId: string,
  data: JoinRequestInput
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot join archived project", "BAD_REQUEST", 400);
  }

  // Check if already a member
  const existingMember = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
  });

  if (existingMember) {
    throw new AppError("You are already a member", "DUPLICATE_ERROR", 409);
  }

  const existing = await prisma.joinRequest.findFirst({
    where: {
      project_id: projectId,
      user_id: userId,
      approved: null,
    },
  });

  if (existing) {
    throw new AppError(
      "You already have a pending join request",
      "DUPLICATE_ERROR",
      409
    );
  }

  const request = await prisma.joinRequest.create({
    data: {
      project_id: projectId,
      user_id: userId,
      role: data.role,
      message: data.message,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.join_request_created,
    title: "Join request created",
    description: `A new join request was submitted for role ${data.role}`,
    actor_id: userId,
    metadata: { role: data.role },
  });

  const recipients = await getProjectSupervisorRecipientIds(projectId, userId);
  for (const recipientId of recipients) {
    await notificationService.createNotification(recipientId, "join_request", {
      projectId,
      actorId: userId,
      projectName: project.name,
      actorName: "申请人",
      reason: data.message || undefined,
    });
  }

  return request;
}

export async function respondToJoinRequest(
  requestId: string,
  approverId: string,
  data: UpdateJoinRequestInput
) {
  const request = await prisma.joinRequest.findUnique({
    where: { id: requestId },
    include: {
      project: { select: { name: true } },
      user: { select: { username: true, nickname: true } },
    },
  });

  if (!request) {
    throw new AppError("Join request not found", "NOT_FOUND", 404);
  }

  if (request.approved !== null) {
    throw new AppError("Join request has already been processed", "BAD_REQUEST", 400);
  }

  const updated = await prisma.joinRequest.update({
    where: { id: requestId },
    data: {
      approved: data.approved,
      approved_by: approverId,
      approved_at: new Date(),
    },
  });

  if (data.approved) {
    await prisma.projectMember.create({
      data: {
        project_id: request.project_id,
        user_id: request.user_id,
        role: request.role,
      },
    });

    await timelineService.createTimelineEvent({
      project_id: request.project_id,
      event_type: TimelineEventType.join_request_approved,
      title: "Join request approved",
      description: `Join request for role ${request.role} was approved`,
      actor_id: approverId,
      metadata: { user_id: request.user_id, role: request.role },
    });
  } else {
    await timelineService.createTimelineEvent({
      project_id: request.project_id,
      event_type: TimelineEventType.join_request_rejected,
      title: "Join request rejected",
      description: `Join request for role ${request.role} was rejected`,
      actor_id: approverId,
      metadata: { user_id: request.user_id, role: request.role },
    });
  }

  const applicantName = request.user.nickname || request.user.username;
  await notificationService.createNotification(
    request.user_id,
    data.approved ? "join_approved" : "join_rejected",
    {
      projectId: request.project_id,
      actorId: approverId,
      projectName: request.project.name,
    }
  );
  await notificationService.createNotification(
    approverId,
    data.approved ? "join_approved" : "join_rejected",
    {
      projectId: request.project_id,
      actorId: approverId,
      projectName: request.project.name,
      actorName: applicantName,
    }
  );

  await auditService.log({
    user_id: approverId,
    action: data.approved ? "project.approve_join" : "project.reject_join",
    resource_type: "join_request",
    resource_id: requestId,
    new_value: updated,
  });

  return updated;
}

export async function getJoinRequests(projectId: string) {
  const requests = await prisma.joinRequest.findMany({
    where: { project_id: projectId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
    orderBy: { created_at: "desc" },
  });

  return requests;
}
