import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { TaskStatus, TaskRole, TimelineEventType, ReviewStatus, ClaimStatus, FileType } from "@prisma/client";
import { randomUUID } from "crypto";
import * as auditService from "../audit/audit.service";
import * as timelineService from "../timeline/timeline.service";
import * as notificationService from "../notification/notification.service";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  TaskQueryInput,
  ClaimSegmentInput,
  SubmitTranslationInput,
  CreateDependencyInput,
  ReviewTaskInput,
  ResetTaskInput,
  UpdateTaskDeadlineInput,
} from "./task.schema";

// Roles that require supervisor review before completion
const REVIEW_REQUIRED_ROLES: TaskRole[] = [
  "translation",
  "post_production",
  "encoding",
  "release",
];

// Serial pipeline order
const ROLE_PIPELINE: TaskRole[] = [
  "source",
  "timing",
  "translation",
  "post_production",
  "encoding",
  "release",
];

const TASK_RETURNABLE_STATUSES: TaskStatus[] = [
  "assigned",
  "in_progress",
  "review_rejected",
  "overdue",
];

const TASK_MANUAL_RESET_STATUSES: TaskStatus[] = [
  "assigned",
  "in_progress",
  "submitted",
  "review_approved",
  "review_rejected",
  "completed",
  "overdue",
  "frozen",
];

const TASK_DOWNSTREAM_RESET_STATUSES: TaskStatus[] = [
  "claimable",
  "assigned",
  "in_progress",
  "submitted",
  "review_approved",
  "review_rejected",
  "completed",
  "overdue",
  "frozen",
];

const RESERVED_TRANSLATION_CLAIM_STATUSES: ClaimStatus[] = ["pending", "active", "submitted"];
const ACTIVE_TRANSLATION_CLAIM_STATUSES: ClaimStatus[] = ["pending", "active"];

type TaskPrerequisiteSubject = {
  id: string;
  project_id: string;
  unit_id: string | null;
  role: TaskRole;
};

type WorkflowPredecessorState = {
  configured: boolean;
  required: boolean;
  ready: boolean;
  missing: boolean;
  predecessorRole?: TaskRole;
  predecessorTaskIds: string[];
};

type TaskPrerequisiteState = {
  ready: boolean;
  dependenciesMet: boolean;
  workflow: WorkflowPredecessorState;
};

/**
 * Check if all dependencies for a task are completed
 */
async function checkDependenciesMet(taskId: string): Promise<boolean> {
  const dependencies = await prisma.taskDependency.findMany({
    where: { task_id: taskId },
    include: { depends_on: { select: { status: true } } },
  });

  if (dependencies.length === 0) return true;

  return dependencies.every(
    (dep) => dep.depends_on.status === "completed"
  );
}

function workflowEntriesFromConfig(value: string | null | undefined): Array<Record<string, unknown>> {
  const arrayEntries = parseJsonArray(value)
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    );
  if (arrayEntries.length > 0) {
    return arrayEntries.map((entry) => ({ ...entry }));
  }

  const objectConfig = parseJsonObject(value);
  return Object.entries(objectConfig)
    .filter(([, config]) => config && typeof config === "object" && !Array.isArray(config))
    .map(([role, config]) => ({
      ...(config as Record<string, unknown>),
      role: (config as Record<string, unknown>).role ?? role,
    }));
}

function isPipelineRole(value: unknown): value is TaskRole {
  return typeof value === "string" && ROLE_PIPELINE.includes(value as TaskRole);
}

function enabledPipelineRolesFromEntries(entries: Array<Record<string, unknown>>): TaskRole[] {
  const enabled = new Set<TaskRole>();
  for (const entry of entries) {
    if (entry.enabled === false || !isPipelineRole(entry.role)) {
      continue;
    }
    enabled.add(entry.role);
  }
  return ROLE_PIPELINE.filter((role) => enabled.has(role));
}

async function getConfiguredPipelineRoles(projectId: string): Promise<TaskRole[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      workflow_config: true,
      template: { select: { roles: true } },
    },
  });

  const projectRoles = enabledPipelineRolesFromEntries(
    workflowEntriesFromConfig(project?.workflow_config)
  );
  if (projectRoles.length > 0) {
    return projectRoles;
  }

  return enabledPipelineRolesFromEntries(
    workflowEntriesFromConfig(project?.template?.roles)
  );
}

async function getWorkflowPredecessorState(
  task: TaskPrerequisiteSubject
): Promise<WorkflowPredecessorState> {
  const configuredRoles = await getConfiguredPipelineRoles(task.project_id);
  if (configuredRoles.length === 0) {
    return { configured: false, required: false, ready: true, missing: false, predecessorTaskIds: [] };
  }

  const roleIndex = configuredRoles.indexOf(task.role);
  if (roleIndex <= 0) {
    return { configured: roleIndex === 0, required: false, ready: true, missing: false, predecessorTaskIds: [] };
  }

  const predecessorRole = configuredRoles[roleIndex - 1];
  const predecessors = await prisma.task.findMany({
    where: {
      project_id: task.project_id,
      unit_id: task.unit_id,
      role: predecessorRole,
      id: { not: task.id },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (predecessors.length === 0) {
    return {
      required: true,
      configured: true,
      ready: false,
      missing: true,
      predecessorRole,
      predecessorTaskIds: [],
    };
  }

  return {
    required: true,
    configured: true,
    ready: predecessors.every((predecessor) => predecessor.status === "completed"),
    missing: false,
    predecessorRole,
    predecessorTaskIds: predecessors.map((predecessor) => predecessor.id),
  };
}

async function getTaskPrerequisiteState(
  task: TaskPrerequisiteSubject
): Promise<TaskPrerequisiteState> {
  const [dependenciesMet, workflow] = await Promise.all([
    checkDependenciesMet(task.id),
    getWorkflowPredecessorState(task),
  ]);

  return {
    ready: dependenciesMet && workflow.ready,
    dependenciesMet,
    workflow,
  };
}

function getTaskPrerequisiteErrorMessage(action: string, state: TaskPrerequisiteState): string {
  if (state.workflow.missing) {
    return `Cannot ${action}: workflow predecessor task is missing`;
  }
  if (!state.workflow.ready) {
    return `Cannot ${action}: workflow predecessor tasks are not completed`;
  }
  return `Cannot ${action}: dependencies not met`;
}

function getUnlockedTaskStatus(task: { assignee_id: string | null }): TaskStatus {
  return task.assignee_id ? "assigned" : "claimable";
}

/**
 * Get downstream tasks (tasks that depend on this task)
 */
async function getDownstreamTasks(taskId: string) {
  const dependents = await prisma.taskDependency.findMany({
    where: { depends_on_id: taskId },
    include: {
      task: true,
    },
  });

  return dependents.map((d) => d.task);
}

async function getWorkflowDownstreamTasks(task: TaskPrerequisiteSubject) {
  const configuredRoles = await getConfiguredPipelineRoles(task.project_id);
  const roleIndex = configuredRoles.indexOf(task.role);
  if (roleIndex < 0 || roleIndex >= configuredRoles.length - 1) {
    return [];
  }

  return prisma.task.findMany({
    where: {
      project_id: task.project_id,
      unit_id: task.unit_id,
      role: configuredRoles[roleIndex + 1],
      id: { not: task.id },
    },
  });
}

function dedupeTasks<T extends { id: string }>(tasks: T[]): T[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (seen.has(task.id)) {
      return false;
    }
    seen.add(task.id);
    return true;
  });
}

async function getDownstreamTasksForWorkflow(task: TaskPrerequisiteSubject) {
  const [explicitDownstream, workflowDownstream] = await Promise.all([
    getDownstreamTasks(task.id),
    getWorkflowDownstreamTasks(task),
  ]);

  return dedupeTasks([...explicitDownstream, ...workflowDownstream]);
}

function translationClaimScope(task: { id: string; project_id: string; unit_id: string | null }) {
  return task.unit_id
    ? { project_id: task.project_id, unit_id: task.unit_id, role: TaskRole.translation }
    : { id: task.id };
}

function normalizeTranslationOrder(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return undefined;
}

function translationOrderFromTask(task: { translation_order?: number | null; created_at?: Date | null }) {
  return task.translation_order ?? Number.MAX_SAFE_INTEGER;
}

function compareTranslationClaims<
  T extends {
    segment_start: number;
    claimed_at: Date;
    task?: { translation_order?: number | null; created_at?: Date | null } | null;
  }
>(a: T, b: T): number {
  const orderDelta = translationOrderFromTask(a.task || {}) - translationOrderFromTask(b.task || {});
  if (orderDelta !== 0) return orderDelta;
  const createdDelta = (a.task?.created_at?.getTime() ?? 0) - (b.task?.created_at?.getTime() ?? 0);
  if (createdDelta !== 0) return createdDelta;
  const segmentDelta = a.segment_start - b.segment_start;
  if (segmentDelta !== 0) return segmentDelta;
  return a.claimed_at.getTime() - b.claimed_at.getTime();
}

async function resolveTranslationOrder(
  projectId: string,
  unitId: string | null | undefined,
  role: TaskRole,
  requestedOrder: number | null | undefined,
  excludeTaskId?: string
) {
  if (role !== TaskRole.translation) {
    return null;
  }

  const where = {
    project_id: projectId,
    unit_id: unitId ?? null,
    role: TaskRole.translation,
    ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
  };

  if (requestedOrder !== undefined && requestedOrder !== null) {
    const duplicate = await prisma.task.findFirst({
      where: {
        ...where,
        translation_order: requestedOrder,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError("Translation order is already used in this episode", "CONFLICT", 409);
    }
    return requestedOrder;
  }

  const max = await prisma.task.aggregate({
    where,
    _max: { translation_order: true },
  });
  if (max._max.translation_order) {
    return max._max.translation_order + 1;
  }

  const count = await prisma.task.count({ where });
  return count + 1;
}

async function activateNextTranslationClaim(task: {
  id: string;
  project_id: string;
  unit_id: string | null;
  title: string;
}) {
  const activeOrSubmittedClaims = await prisma.translationClaim.findMany({
    where: {
      task: translationClaimScope(task),
      status: { in: ["active", "submitted"] },
    },
    include: {
      task: {
        select: {
          translation_order: true,
          created_at: true,
        },
      },
    },
  });
  const activeOrSubmitted = activeOrSubmittedClaims.sort(compareTranslationClaims)[0];

  if (activeOrSubmitted) {
    return activeOrSubmitted;
  }

  const pendingClaims = await prisma.translationClaim.findMany({
    where: {
      task: translationClaimScope(task),
      status: "pending",
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      task: {
        select: {
          id: true,
          project_id: true,
          title: true,
          translation_order: true,
          created_at: true,
        },
      },
    },
  });
  const next = pendingClaims.sort(compareTranslationClaims)[0];

  if (!next) {
    return null;
  }

  const activated = await prisma.translationClaim.update({
    where: { id: next.id },
    data: { status: "active" },
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

  await prisma.task.update({
    where: { id: next.task_id },
    data: {
      status: "assigned",
      assignee_id: next.user_id,
      started_at: null,
      submitted_at: null,
      completed_at: null,
    },
  });

  await notificationService.createNotification(next.user_id, "task_assigned", {
    projectId: next.task.project_id,
    taskId: next.task_id,
    taskName: next.task.title,
    reason: "上一段翻译已通过，请下载最新通过版本继续下一段翻译",
  });

  return activated;
}

async function getTranslationCoverageSeconds(task: {
  id: string;
  project_id: string;
  unit_id: string | null;
}) {
  const claims = await prisma.translationClaim.findMany({
    where: {
      task: translationClaimScope(task),
      status: { in: ["pending", "active", "submitted", "approved"] },
    },
    select: {
      segment_start: true,
      segment_end: true,
    },
    orderBy: { segment_start: "asc" },
  });

  let covered = 0;
  let lastEnd = 0;
  for (const claim of claims) {
    if (claim.segment_start <= lastEnd) {
      covered += Math.max(0, claim.segment_end - lastEnd);
      lastEnd = Math.max(lastEnd, claim.segment_end);
    } else {
      covered += claim.segment_end - claim.segment_start;
      lastEnd = claim.segment_end;
    }
  }

  return covered;
}

async function isTranslationCoverageComplete(task: {
  id: string;
  project_id: string;
  unit_id: string | null;
  unit?: { episode_length: number | null } | null;
}) {
  if (!task.unit?.episode_length) {
    return false;
  }

  return (await getTranslationCoverageSeconds(task)) >= task.unit.episode_length;
}

function parseMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function metadataStringValue(metadata: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numberFromRecord(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function stringArrayFromRecord(record: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.length > 0);
    }
  }
  return [];
}

async function canSupervisorOverride(projectId: string, actorId?: string): Promise<boolean> {
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
    prisma.projectMember.findUnique({
      where: {
        project_id_user_id: {
          project_id: projectId,
          user_id: actorId,
        },
      },
      select: { role: true, is_lead: true },
    }),
  ]);

  return Boolean(
    actor?.role === "super_admin" ||
    actor?.role === "group_admin" ||
    actor?.role === "supervisor" ||
    project?.owner_id === actorId ||
    membership?.role === "supervisor" ||
    membership?.is_lead
  );
}

async function canManageProjectTasks(projectId: string, actorId?: string): Promise<boolean> {
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
      select: { role: true, is_lead: true },
    }),
  ]);

  return Boolean(
    actor?.role === "super_admin" ||
    actor?.role === "group_admin" ||
    actor?.role === "supervisor" ||
    project?.owner_id === actorId ||
    membership?.role === "supervisor" ||
    membership?.is_lead
  );
}

async function getTaskRoleMaxSegmentLength(
  projectId: string,
  role: TaskRole
): Promise<number | undefined> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      workflow_config: true,
      template: { select: { roles: true } },
    },
  });

  const roleEntries = [
    ...parseJsonArray(project?.workflow_config),
    ...parseJsonArray(project?.template?.roles),
  ];

  for (const entry of roleEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (record.role === role) {
      return numberFromRecord(record, "maxSegmentLength", "max_segment_length");
    }
  }

  const configObject = parseJsonObject(project?.workflow_config);
  const roleConfig = configObject[role];
  if (roleConfig && typeof roleConfig === "object" && !Array.isArray(roleConfig)) {
    return numberFromRecord(roleConfig as Record<string, unknown>, "maxSegmentLength", "max_segment_length");
  }

  return undefined;
}

async function hasRequiredRoleTag(userId: string, role: TaskRole): Promise<boolean> {
  const tag = await prisma.roleTag.findFirst({
    where: {
      name: { equals: role },
    },
    select: { id: true },
  });

  if (!tag) {
    return true;
  }

  const approved = await prisma.tagApplication.findFirst({
    where: {
      user_id: userId,
      tag_id: tag.id,
      approved: true,
    },
  });

  return Boolean(approved);
}

async function getTaskRoleRequiredTagIds(projectId: string, role: TaskRole): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      workflow_config: true,
      template: { select: { roles: true } },
    },
  });

  const roleEntries = [
    ...parseJsonArray(project?.workflow_config),
    ...parseJsonArray(project?.template?.roles),
  ];

  for (const entry of roleEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (record.role === role) {
      return stringArrayFromRecord(record, "requiredTagIds", "required_tag_ids");
    }
  }

  const configObject = parseJsonObject(project?.workflow_config);
  const roleConfig = configObject[role];
  if (roleConfig && typeof roleConfig === "object" && !Array.isArray(roleConfig)) {
    return stringArrayFromRecord(roleConfig as Record<string, unknown>, "requiredTagIds", "required_tag_ids");
  }

  return [];
}

async function hasAnyRequiredRoleTag(userId: string, tagIds: string[]): Promise<boolean> {
  if (tagIds.length === 0) {
    return true;
  }

  const approved = await prisma.tagApplication.findFirst({
    where: {
      user_id: userId,
      tag_id: { in: tagIds },
      approved: true,
    },
    select: { id: true },
  });

  return Boolean(approved);
}

async function assertTaskClaimRoleTagAccess(
  userId: string,
  projectId: string,
  role: TaskRole,
  message: string
): Promise<void> {
  const requiredTagIds = await getTaskRoleRequiredTagIds(projectId, role);
  if (requiredTagIds.length > 0) {
    if (!(await hasAnyRequiredRoleTag(userId, requiredTagIds))) {
      throw new AppError(message, "FORBIDDEN", 403);
    }
    return;
  }

  if (!(await hasRequiredRoleTag(userId, role))) {
    throw new AppError(message, "FORBIDDEN", 403);
  }
}

async function getWorkflowReviewerIds(projectId: string): Promise<string[]> {
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
  ];
}

async function getProjectDisplayName(projectId: string): Promise<string | undefined> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  return project?.name;
}

async function notifyUnlockedDownstreamTask(
  task: { id: string; project_id: string; title: string; role: TaskRole; assignee_id: string | null },
  actorId?: string
): Promise<void> {
  const projectName = await getProjectDisplayName(task.project_id);

  if (task.assignee_id) {
    await notificationService.createNotification(task.assignee_id, "task_assigned", {
      projectId: task.project_id,
      taskId: task.id,
      taskName: task.title,
      projectName,
      actorId,
      reason: "依赖任务已完成，当前任务已解锁",
    });
    return;
  }

  const waiters = await prisma.projectMember.findMany({
    where: {
      project_id: task.project_id,
      role: task.role,
      left_at: null,
    },
    select: { user_id: true },
  });

  const recipients = [...new Set(waiters.map((waiter) => waiter.user_id))]
    .filter((userId) => userId !== actorId);

  for (const userId of recipients) {
    await notificationService.createNotification(userId, "project_update", {
      projectId: task.project_id,
      taskId: task.id,
      taskName: task.title,
      projectName,
      actorId,
      reason: "依赖任务已完成，开放任务可领取",
    });
  }
}

async function unlockPendingTaskIfReady(
  task: {
    id: string;
    project_id: string;
    unit_id: string | null;
    title: string;
    role: TaskRole;
    assignee_id: string | null;
    status: TaskStatus;
  },
  actorId?: string
): Promise<boolean> {
  if (task.status !== "pending_publish") return false;
  if (!(await getTaskPrerequisiteState(task)).ready) return false;

  await prisma.task.update({
    where: { id: task.id },
    data: { status: getUnlockedTaskStatus(task) },
  });
  await notifyUnlockedDownstreamTask(task, actorId);
  return true;
}

async function unlockDownstreamTasksIfReady(
  task: TaskPrerequisiteSubject,
  actorId?: string
): Promise<void> {
  const downstream = await getDownstreamTasksForWorkflow(task);
  for (const downTask of downstream) {
    await unlockPendingTaskIfReady(downTask, actorId);
  }
}

async function reconcileTaskDependencyState(taskId: string, actorId?: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      project_id: true,
      unit_id: true,
      title: true,
      role: true,
      assignee_id: true,
      status: true,
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (await unlockPendingTaskIfReady(task, actorId)) return;

  const prerequisiteState = await getTaskPrerequisiteState(task);
  if (prerequisiteState.ready) return;

  const shouldDemote =
    task.status === "claimable" ||
    task.status === "assigned" ||
    (prerequisiteState.workflow.missing && TASK_DOWNSTREAM_RESET_STATUSES.includes(task.status));

  if (shouldDemote) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "pending_publish",
        started_at: null,
        submitted_at: null,
        completed_at: null,
      },
    });
  }
}

async function findLatestUploadedTranslationVersionForClaim(
  task: { id: string; project_id: string; unit_id: string | null },
  claim: { user_id: string }
) {
  const files = await prisma.fileEntity.findMany({
    where: {
      project_id: task.project_id,
      uploader_id: claim.user_id,
      file_type: FileType.subtitle,
      is_deleted: false,
    },
    include: {
      versions: {
        orderBy: { version_number: "desc" },
        take: 1,
      },
    },
    orderBy: { created_at: "desc" },
  });

  return files
    .filter((file) => {
      const metadata = parseMetadata(file.metadata);
      const taskId = metadataStringValue(metadata, "task_id", "taskId");
      const unitId = metadataStringValue(metadata, "unit_id", "unitId");
      const role = metadataStringValue(metadata, "role", "task_role");
      return (
        taskId === task.id ||
        (Boolean(task.unit_id) && unitId === task.unit_id && role === TaskRole.translation)
      );
    })
    .map((file) => ({
      file,
      version: file.versions[0],
    }))
    .filter((item) => Boolean(item.version))
    .sort((a, b) => {
      const aTime = a.version!.created_at?.getTime?.() ?? a.file.created_at.getTime();
      const bTime = b.version!.created_at?.getTime?.() ?? b.file.created_at.getTime();
      return bTime - aTime;
    })[0] || null;
}

async function ensureTranslationSubmissionForClaim(
  task: { id: string; project_id: string; unit_id: string | null },
  claim: { id: string; user_id: string }
) {
  const existing = await prisma.translationSubmission.findFirst({
    where: { claim_id: claim.id },
    orderBy: { submitted_at: "desc" },
  });

  const uploaded = await findLatestUploadedTranslationVersionForClaim(task, claim);

  if (existing) {
    if (!existing.file_version_id && uploaded?.version?.id) {
      return prisma.translationSubmission.update({
        where: { id: existing.id },
        data: { file_version_id: uploaded.version.id },
      });
    }
    return existing;
  }

  if (!uploaded?.version?.id) {
    throw new AppError("请先上传当前翻译分段的字幕文件后再提交审核", "VALIDATION_ERROR", 400);
  }

  return prisma.translationSubmission.create({
    data: {
      task_id: task.id,
      user_id: claim.user_id,
      claim_id: claim.id,
      file_version_id: uploaded.version.id,
      content: "",
      line_count: null,
    },
  });
}

async function getSubmittedTranslationClaimForApproval(task: {
  id: string;
  project_id: string;
  unit_id: string | null;
  assignee_id: string | null;
  status: TaskStatus;
}) {
  const submittedClaims = await prisma.translationClaim.findMany({
    where: {
      task: translationClaimScope(task),
      status: "submitted",
    },
    include: {
      task: {
        select: {
          translation_order: true,
          created_at: true,
        },
      },
    },
  });
  const submittedClaim = submittedClaims.sort(compareTranslationClaims)[0];

  if (submittedClaim) {
    await ensureTranslationSubmissionForClaim(task, submittedClaim);
    return submittedClaim;
  }

  if (task.status !== "submitted") {
    return null;
  }

  const activeClaims = await prisma.translationClaim.findMany({
    where: {
      task: translationClaimScope(task),
      status: "active",
      ...(task.assignee_id ? { user_id: task.assignee_id } : {}),
    },
    include: {
      task: {
        select: {
          translation_order: true,
          created_at: true,
        },
      },
    },
  });
  const activeClaim = activeClaims.sort(compareTranslationClaims)[0];

  if (!activeClaim) {
    return null;
  }

  await ensureTranslationSubmissionForClaim(task, activeClaim);
  return prisma.translationClaim.update({
    where: { id: activeClaim.id },
    data: {
      status: "submitted",
      submitted_at: new Date(),
    },
  });
}

async function discardReleaseArtifacts(
  task: { id: string; project_id: string },
  actorId?: string
): Promise<{ fileIds: string[]; linkCount: number }> {
  const projectFiles = await prisma.fileEntity.findMany({
    where: {
      project_id: task.project_id,
      is_deleted: false,
    },
    select: {
      id: true,
      metadata: true,
    },
  });

  const fileIds = projectFiles
    .filter((file) => {
      const metadata = parseMetadata(file.metadata);
      return metadata.task_id === task.id || metadata.taskId === task.id;
    })
    .map((file) => file.id);

  let linkCount = 0;
  if (fileIds.length > 0) {
    const linkDelete = await prisma.linkHistory.deleteMany({
      where: {
        project_id: task.project_id,
        file_id: { in: fileIds },
      },
    });
    linkCount = linkDelete.count;

    await prisma.fileEntity.updateMany({
      where: { id: { in: fileIds } },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: actorId,
      },
    });
  }

  await auditService.log({
    user_id: actorId,
    project_id: task.project_id,
    action: "task.release_artifacts_discard",
    resource_type: "task",
    resource_id: task.id,
    new_value: { file_ids: fileIds, link_count: linkCount },
  });

  return { fileIds, linkCount };
}

/**
 * Cascade reset downstream tasks whose work is invalidated by upstream changes.
 */
async function cascadeResetDownstream(
  taskId: string,
  actorId?: string
): Promise<void> {
  const downstream = await getDownstreamTasks(taskId);

  for (const downTask of downstream) {
    if (TASK_DOWNSTREAM_RESET_STATUSES.includes(downTask.status)) {
      const isReleaseReset = downTask.role === "release";
      const shouldWaitForUpstream =
        isReleaseReset ||
        ((downTask.status === "claimable" || downTask.status === "frozen") && !downTask.assignee_id);
      const nextStatus: TaskStatus = shouldWaitForUpstream ? "pending_publish" : "in_progress";
      if (isReleaseReset) {
        await discardReleaseArtifacts(downTask, actorId);
      }

      await prisma.task.update({
        where: { id: downTask.id },
        data: {
          status: nextStatus,
          started_at: nextStatus === "in_progress" ? downTask.started_at : null,
          completed_at: null,
          submitted_at: null,
          cancelled_at: null,
          frozen_at: null,
        },
      });

      await timelineService.createTimelineEvent({
        project_id: downTask.project_id,
        event_type: TimelineEventType.task_reset,
        title: "Task auto-reset due to upstream change",
        description: `Task "${downTask.title}" was reset because an upstream task was modified`,
        actor_id: actorId,
        metadata: { task_id: downTask.id, upstream_task_id: taskId },
      });

      // Notify downstream assignee
      if (downTask.assignee_id) {
        await notificationService.createNotification(downTask.assignee_id, "downstream_reset", {
          projectId: downTask.project_id,
          taskId: downTask.id,
          taskName: downTask.title,
          actorId,
        });
      }

      // Recursively cascade
      await cascadeResetDownstream(downTask.id, actorId);
    }
  }
}

/**
 * Freeze unstarted downstream tasks when a task is cancelled
 */
async function freezeDownstreamTasks(
  taskId: string,
  actorId?: string
): Promise<{ frozen: string[]; warned: string[] }> {
  const downstream = await getDownstreamTasks(taskId);
  const frozen: string[] = [];
  const warned: string[] = [];

  for (const downTask of downstream) {
    if (
      downTask.status === "pending_publish" ||
      downTask.status === "claimable" ||
      downTask.status === "assigned"
    ) {
      await prisma.task.update({
        where: { id: downTask.id },
        data: {
          status: "frozen",
          frozen_at: new Date(),
        },
      });
      frozen.push(downTask.id);

      await timelineService.createTimelineEvent({
        project_id: downTask.project_id,
        event_type: TimelineEventType.task_frozen,
        title: "Task frozen due to upstream cancellation",
        description: `Task "${downTask.title}" was frozen because an upstream task was cancelled`,
        actor_id: actorId,
        metadata: { task_id: downTask.id },
      });

      // Notify downstream assignee of freeze
      if (downTask.assignee_id) {
        await notificationService.createNotification(downTask.assignee_id, "task_cancelled", {
          projectId: downTask.project_id,
          taskId: downTask.id,
          taskName: downTask.title,
          actorId,
        });
      }
    } else if (downTask.status === "in_progress") {
      warned.push(downTask.id);

      // Warn in-progress downstream assignee
      if (downTask.assignee_id) {
        await notificationService.createNotification(downTask.assignee_id, "task_cancelled", {
          projectId: downTask.project_id,
          taskId: downTask.id,
          taskName: downTask.title,
          actorId,
        });
      }
    }

    // Recursively freeze further downstream
    const subResults = await freezeDownstreamTasks(downTask.id, actorId);
    frozen.push(...subResults.frozen);
    warned.push(...subResults.warned);
  }

  return { frozen, warned };
}

export async function createTask(creatorId: string, data: CreateTaskInput) {
  const project = await prisma.project.findUnique({
    where: { id: data.project_id, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot create tasks in archived project", "BAD_REQUEST", 400);
  }

  const requestedTranslationOrder = normalizeTranslationOrder(
    data.translation_order ?? data.translationOrder
  );
  const translationOrder = await resolveTranslationOrder(
    data.project_id,
    data.unit_id ?? null,
    data.role,
    requestedTranslationOrder
  );
  const taskId = randomUUID();
  const prerequisiteState = await getTaskPrerequisiteState({
    id: taskId,
    project_id: data.project_id,
    unit_id: data.unit_id ?? null,
    role: data.role,
  });
  const shouldUnlockOnCreate =
    prerequisiteState.ready && (Boolean(data.assignee_id) || prerequisiteState.workflow.configured);

  const task = await prisma.task.create({
    data: {
      id: taskId,
      project_id: data.project_id,
      unit_id: data.unit_id,
      title: data.title,
      description: data.description,
      role: data.role,
      translation_order: translationOrder,
      assignee_id: data.assignee_id,
      creator_id: creatorId,
      due_date: data.due_date ? new Date(data.due_date) : null,
      status: shouldUnlockOnCreate
        ? getUnlockedTaskStatus({ assignee_id: data.assignee_id ?? null })
        : "pending_publish",
      started_at: data.assignee_id ? null : null,
    },
    include: {
      assignee: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  await timelineService.createTimelineEvent({
    project_id: data.project_id,
    event_type: TimelineEventType.task_created,
    title: "Task created",
    description: `Task "${task.title}" was created`,
    actor_id: creatorId,
    metadata: { task_id: task.id, role: task.role, translation_order: task.translation_order },
  });

  await auditService.log({
    user_id: creatorId,
    action: "task.create",
    resource_type: "task",
    resource_id: task.id,
    new_value: task,
  });

  return task;
}

export async function getTasks(query: TaskQueryInput) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  const projectId = query.project_id ?? query.projectId;
  const unitId = query.unit_id ?? query.unitId;
  const assigneeId = query.assignee_id ?? query.assigneeId;

  if (projectId) {
    where.project_id = projectId;
  }
  if (unitId) {
    where.unit_id = unitId;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.role) {
    where.role = query.role;
  }
  if (assigneeId) {
    where.assignee_id = assigneeId;
  }

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
      include: {
        assignee: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar_url: true,
          },
        },
        unit: {
          select: {
            id: true,
            season_number: true,
            unit_number: true,
            title: true,
            episode_length: true,
          },
        },
        claims: {
          where: { status: { in: ACTIVE_TRANSLATION_CLAIM_STATUSES } },
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
    }),
    prisma.task.count({ where }),
  ]);

  return {
    tasks,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getTaskById(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      unit: true,
      claims: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              nickname: true,
            },
          },
          task: {
            select: {
              id: true,
              title: true,
              translation_order: true,
              created_at: true,
            },
          },
        },
      },
      dependencies: {
        include: {
          depends_on: {
            select: {
              id: true,
              title: true,
              status: true,
              role: true,
            },
          },
        },
      },
      dependents: {
        include: {
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              role: true,
            },
          },
        },
      },
      reviews: {
        include: {
          reviewer: {
            select: {
              id: true,
              username: true,
              nickname: true,
            },
          },
        },
        orderBy: { submitted_at: "desc" },
      },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.role === "translation" && task.unit_id) {
    const unitClaims = await prisma.translationClaim.findMany({
      where: {
        unit_id: task.unit_id,
        status: { in: ["pending", "active", "submitted", "approved", "rejected"] },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
            translation_order: true,
            created_at: true,
          },
        },
      },
    });
    return {
      ...task,
      claims: unitClaims.sort(compareTranslationClaims),
    };
  }

  return task;
}

export async function updateTask(
  taskId: string,
  data: UpdateTaskInput,
  actorId?: string
) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!existing) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (existing.project.deleted_at) {
    throw new AppError("Cannot update task in deleted project", "BAD_REQUEST", 400);
  }

  if (existing.project.is_archived) {
    throw new AppError("Cannot update task in archived project", "BAD_REQUEST", 400);
  }

  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.role !== undefined) updateData.role = data.role;
  const nextRole = data.role ?? existing.role;
  const requestedTranslationOrder = normalizeTranslationOrder(
    data.translation_order ?? data.translationOrder
  );
  if (nextRole === TaskRole.translation) {
    const shouldResolveOrder =
      data.role !== undefined ||
      data.translation_order !== undefined ||
      data.translationOrder !== undefined ||
      existing.translation_order === null;
    if (shouldResolveOrder) {
      updateData.translation_order = await resolveTranslationOrder(
        existing.project_id,
        existing.unit_id,
        nextRole,
        requestedTranslationOrder ?? existing.translation_order ?? undefined,
        taskId
      );
    }
  } else if (data.role !== undefined && existing.role === TaskRole.translation) {
    updateData.translation_order = null;
  }
  if (data.assignee_id !== undefined) updateData.assignee_id = data.assignee_id;
  if (data.due_date !== undefined) {
    updateData.due_date = data.due_date ? new Date(data.due_date) : null;
  }

  // If task content is modified and it has downstream dependents that are completed,
  // cascade reset them
  const contentModified =
    data.title !== undefined || data.description !== undefined || data.role !== undefined;

  const task = await prisma.task.update({
    where: { id: taskId },
    data: updateData,
    include: {
      assignee: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  // Cascade reset downstream if content was modified
  if (contentModified) {
    await cascadeResetDownstream(taskId, actorId);
  }

  await auditService.log({
    user_id: actorId,
    action: "task.update",
    resource_type: "task",
    resource_id: taskId,
    old_value: existing,
    new_value: task,
  });

  return task;
}

export async function deleteTask(taskId: string, actorId?: string) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          owner_id: true,
          is_archived: true,
          deleted_at: true,
        },
      },
      dependencies: {
        select: {
          id: true,
          depends_on_id: true,
        },
      },
      dependents: {
        select: {
          id: true,
          task_id: true,
        },
      },
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
  });

  if (!existing) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (existing.project.deleted_at) {
    throw new AppError("Cannot delete task in deleted project", "BAD_REQUEST", 400);
  }

  if (existing.project.is_archived) {
    throw new AppError("Cannot delete task in archived project", "BAD_REQUEST", 400);
  }

  if (!(await canManageProjectTasks(existing.project_id, actorId))) {
    throw new AppError("Only project supervisors or admins can delete tasks", "FORBIDDEN", 403);
  }

  const workflowDependents = await getWorkflowDownstreamTasks(existing);
  const dependentTaskIds = Array.from(new Set([
    ...existing.dependents.map((dependent) => dependent.task_id),
    ...workflowDependents.map((dependent) => dependent.id),
  ]));

  if (dependentTaskIds.length > 0) {
    await cascadeResetDownstream(taskId, actorId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.notification.updateMany({
      where: { task_id: taskId },
      data: { task_id: null },
    });

    await tx.taskDependency.deleteMany({
      where: {
        OR: [
          { task_id: taskId },
          { depends_on_id: taskId },
        ],
      },
    });

    await tx.task.delete({
      where: { id: taskId },
    });

    await tx.timelineEvent.create({
      data: {
        project_id: existing.project_id,
        event_type: TimelineEventType.custom,
        title: "任务已删除",
        description: `任务「${existing.title}」已删除`,
        actor_id: actorId,
        metadata: JSON.stringify({
          task_id: taskId,
          role: existing.role,
          unit_id: existing.unit_id,
          dependency_count: existing.dependencies.length,
          dependent_count: dependentTaskIds.length,
          notification_count: existing._count.notifications,
        }),
      },
    });
  });

  for (const dependentTaskId of dependentTaskIds) {
    await reconcileTaskDependencyState(dependentTaskId, actorId);
  }

  await auditService.log({
    user_id: actorId,
    project_id: existing.project_id,
    action: "task.delete",
    resource_type: "task",
    resource_id: taskId,
    old_value: existing,
  });

  return { success: true, id: taskId };
}

// ==================== TASK STATE TRANSITIONS ====================

export async function claimTask(
  taskId: string,
  userId: string,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at) {
    throw new AppError("Cannot claim task in deleted project", "BAD_REQUEST", 400);
  }

  if (task.project.is_archived) {
    throw new AppError("Cannot claim task in archived project", "BAD_REQUEST", 400);
  }

  if (task.status !== "claimable") {
    throw new AppError(
      `Task cannot be claimed. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  if (task.role === "translation") {
    throw new AppError(
      "Translation tasks must be claimed by selecting a time segment",
      "BAD_REQUEST",
      400
    );
  }

  // Check dependencies and configured workflow predecessor stage.
  const prerequisiteState = await getTaskPrerequisiteState(task);
  if (!prerequisiteState.ready) {
    throw new AppError(
      getTaskPrerequisiteErrorMessage("claim task", prerequisiteState),
      "DEPENDENCY_NOT_MET",
      400
    );
  }

  // Check if user is a member of the project with the right role
  const membership = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: task.project_id,
        user_id: userId,
      },
    },
  });

  // Allow claim if member has matching role or is supervisor
  const canClaim =
    membership &&
    (membership.role === task.role || membership.role === "supervisor");

  if (!canClaim) {
    throw new AppError(
      "You must be a project member with the appropriate role to claim this task",
      "FORBIDDEN",
      403
    );
  }

  if (membership?.role !== "supervisor") {
    await assertTaskClaimRoleTagAccess(
      userId,
      task.project_id,
      task.role,
      `You need a granted ${task.role} role tag to claim this task`
    );
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      assignee_id: userId,
      status: "assigned",
    },
    include: {
      assignee: {
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
    project_id: task.project_id,
    event_type: TimelineEventType.task_claimed,
    title: "Task claimed",
    description: `Task "${task.title}" was claimed`,
    actor_id: userId,
    metadata: { task_id: taskId },
  });

  await auditService.log({
    user_id: actorId || userId,
    action: "task.claim",
    resource_type: "task",
    resource_id: taskId,
    new_value: updated,
  });

  return updated;
}

export async function assignTask(
  taskId: string,
  assigneeId: string,
  actorId?: string,
  overrideReason?: string | null
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot assign task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (
    task.status !== "pending_publish" &&
    task.status !== "claimable" &&
    task.status !== "assigned"
  ) {
    throw new AppError(
      `Task cannot be assigned. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  // Check dependencies and configured workflow predecessor stage.
  const prerequisiteState = await getTaskPrerequisiteState(task);
  const depsMet = prerequisiteState.ready;
  const hasOverrideReason = Boolean(overrideReason?.trim());
  let appliesOverride = false;

  if (!depsMet && !prerequisiteState.workflow.missing && (task.status !== "pending_publish" || hasOverrideReason)) {
    const canOverride = await canSupervisorOverride(task.project_id, actorId);
    if (!canOverride) {
      throw new AppError(
        getTaskPrerequisiteErrorMessage("assign task", prerequisiteState),
        "DEPENDENCY_NOT_MET",
        400
      );
    }

    if (!hasOverrideReason) {
      throw new AppError(
        "Override reason is required when assigning before dependencies are complete",
        "VALIDATION_ERROR",
        400
      );
    }

    appliesOverride = true;
  }

  const previousAssigneeId = task.assignee_id;
  const nextStatus: TaskStatus =
    !prerequisiteState.workflow.missing && (depsMet || appliesOverride)
      ? "assigned"
      : "pending_publish";

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      assignee_id: assigneeId,
      status: nextStatus,
    },
    include: {
      assignee: {
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
    project_id: task.project_id,
    event_type: TimelineEventType.task_assigned,
    title: "Task assigned",
    description: `Task "${task.title}" was assigned`,
    actor_id: actorId,
    metadata: { task_id: taskId, assignee_id: assigneeId },
  });

  // Notify previous assignee if task was reassigned
  if (previousAssigneeId && previousAssigneeId !== assigneeId) {
    await notificationService.createNotification(previousAssigneeId, "task_reassigned", {
      projectId: task.project_id,
      taskId: taskId,
      taskName: task.title,
      actorId,
    });
  }

  // Notify new assignee
  if (assigneeId !== actorId) {
    await notificationService.createNotification(assigneeId, "task_assigned", {
      projectId: task.project_id,
      taskId: taskId,
      taskName: task.title,
      actorId,
      reason: nextStatus === "pending_publish"
        ? "任务已预指派，等待前置任务完成后解锁"
        : undefined,
    });
  }

  await auditService.log({
    user_id: actorId,
    action: appliesOverride ? "task.override_assign" : "task.assign",
    resource_type: "task",
    resource_id: taskId,
    old_value: task,
    new_value: appliesOverride ? { ...updated, override_reason: overrideReason } : updated,
  });

  return updated;
}

export async function returnTask(
  taskId: string,
  userId: string,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot return task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (!TASK_RETURNABLE_STATUSES.includes(task.status)) {
    throw new AppError(
      `Task cannot be returned. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  const actor = actorId || userId;
  const isAssignee = task.assignee_id === userId;
  const canForceReturn = await canManageProjectTasks(task.project_id, actor);

  if (!isAssignee && !canForceReturn) {
    throw new AppError(
      "Only the assigned member or project supervisors can return this task",
      "FORBIDDEN",
      403
    );
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      assignee_id: null,
      status: "claimable",
      started_at: null,
      submitted_at: null,
      completed_at: null,
      frozen_at: null,
    },
  });

  await cascadeResetDownstream(taskId, actor);

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_returned,
    title: isAssignee ? "Task returned" : "Task force returned",
    description: `Task "${task.title}" was returned to the pool`,
    actor_id: actor,
    metadata: { task_id: taskId },
  });

  await auditService.log({
    user_id: actor,
    action: isAssignee ? "task.return" : "task.force_return",
    resource_type: "task",
    resource_id: taskId,
    old_value: task,
    new_value: updated,
  });

  return updated;
}

export async function startTask(
  taskId: string,
  userId: string,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot start task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (task.status !== "assigned" && task.status !== "claimable") {
    throw new AppError(
      `Task cannot be started. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  // Check dependencies and configured workflow predecessor stage.
  const prerequisiteState = await getTaskPrerequisiteState(task);
  if (!prerequisiteState.ready) {
    throw new AppError(
      getTaskPrerequisiteErrorMessage("start task", prerequisiteState),
      "DEPENDENCY_NOT_MET",
      400
    );
  }

  if (task.role === TaskRole.translation) {
    const activeClaim = await prisma.translationClaim.findFirst({
      where: {
        task: translationClaimScope(task),
        user_id: userId,
        status: "active",
      },
    });

    if (!activeClaim) {
      throw new AppError(
        "Only the currently active translator can start this translation segment",
        "FORBIDDEN",
        403
      );
    }
  }

  // If claimable, auto-assign to the user starting it
  const updateData: Record<string, unknown> = {
    status: "in_progress",
    started_at: new Date(),
  };

  if (task.status === "claimable") {
    updateData.assignee_id = userId;
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: updateData,
  });

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_started,
    title: "Task started",
    description: `Task "${task.title}" is now in progress`,
    actor_id: userId,
    metadata: { task_id: taskId },
  });

  await auditService.log({
    user_id: actorId || userId,
    action: "task.start",
    resource_type: "task",
    resource_id: taskId,
    new_value: updated,
  });

  return updated;
}

export async function submitTask(
  taskId: string,
  userId: string,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot submit task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (task.status !== "in_progress") {
    throw new AppError(
      `Task cannot be submitted. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  // Only the assignee can submit
  if (task.assignee_id !== userId) {
    throw new AppError("Only the assigned member can submit this task", "FORBIDDEN", 403);
  }

  let activeTranslationClaim: { id: string; user_id: string } | null = null;
  if (task.role === TaskRole.translation) {
    activeTranslationClaim = await prisma.translationClaim.findFirst({
      where: {
        task: translationClaimScope(task),
        user_id: userId,
        status: "active",
      },
      select: { id: true, user_id: true },
    });

    if (!activeTranslationClaim) {
      throw new AppError(
        "Only the active translation segment can be submitted",
        "FORBIDDEN",
        403
      );
    }

    await ensureTranslationSubmissionForClaim(task, activeTranslationClaim);
  }

  const requiresReview = REVIEW_REQUIRED_ROLES.includes(task.role);
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: requiresReview ? "submitted" : "completed",
      submitted_at: requiresReview ? new Date() : null,
      completed_at: requiresReview ? null : new Date(),
    },
  });

  if (activeTranslationClaim) {
    await prisma.translationClaim.update({
      where: { id: activeTranslationClaim.id },
      data: {
        status: "submitted",
        submitted_at: new Date(),
      },
    });
  }

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: requiresReview ? TimelineEventType.task_submitted : TimelineEventType.task_completed,
    title: requiresReview ? "Task submitted for review" : "Task completed",
    description: requiresReview
      ? `Task "${task.title}" was submitted for review`
      : `Task "${task.title}" was completed`,
    actor_id: userId,
    metadata: { task_id: taskId },
  });

  if (requiresReview) {
    const reviewerIds = (await getWorkflowReviewerIds(task.project_id))
      .filter((reviewerId) => reviewerId !== userId);
    const projectName = await getProjectDisplayName(task.project_id);

    for (const reviewerId of reviewerIds) {
      const review = await prisma.review.create({
        data: {
          project_id: task.project_id,
          task_id: taskId,
          reviewer_id: reviewerId,
          requester_id: userId,
          status: ReviewStatus.pending,
        },
      });

      await notificationService.createNotification(reviewerId, "review_requested", {
        projectId: task.project_id,
        taskId,
        actorId: userId,
        taskName: task.title,
        projectName,
        extra: { review_id: review.id },
      });
    }
  } else {
    await unlockDownstreamTasksIfReady(task, userId);
  }

  await auditService.log({
    user_id: actorId || userId,
    action: "task.submit",
    resource_type: "task",
    resource_id: taskId,
    new_value: updated,
  });

  return updated;
}

export async function cancelTask(
  taskId: string,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot cancel task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (
    task.status === "completed" ||
    task.status === "frozen"
  ) {
    throw new AppError(
      `Task cannot be cancelled. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "frozen",
      cancelled_at: new Date(),
      frozen_at: new Date(),
    },
  });

  // Freeze unstarted downstream, warn for in-progress downstream
  const { frozen, warned } = await freezeDownstreamTasks(taskId, actorId);

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_cancelled,
    title: "Task cancelled",
    description: `Task "${task.title}" was cancelled. ${frozen.length} downstream tasks frozen, ${warned.length} in-progress downstream tasks warned.`,
    actor_id: actorId,
    metadata: { task_id: taskId, frozen_count: frozen.length, warned_count: warned.length },
  });

  await auditService.log({
    user_id: actorId,
    action: "task.cancel",
    resource_type: "task",
    resource_id: taskId,
    old_value: task,
    new_value: updated,
  });

  return { task: updated, frozen, warned };
}

export async function approveTask(
  taskId: string,
  reviewerId: string,
  data: ReviewTaskInput,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
      unit: { select: { episode_length: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot approve task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (task.status !== "submitted") {
    throw new AppError(
      `Task cannot be approved. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  const submittedTranslationClaim = task.role === TaskRole.translation
    ? await getSubmittedTranslationClaimForApproval(task)
    : null;

  if (task.role === TaskRole.translation && !submittedTranslationClaim) {
    throw new AppError("No submitted translation segment is waiting for approval", "BAD_REQUEST", 400);
  }

  // Create review record
  const review = await prisma.review.create({
    data: {
      project_id: task.project_id,
      task_id: taskId,
      reviewer_id: reviewerId,
      requester_id: task.assignee_id,
      status: ReviewStatus.approved,
      comments: data.comments,
      line_comments: data.line_comments,
      completed_at: new Date(),
    },
  });

  let updated;
  if (task.role === TaskRole.translation) {
    const submittedClaim = submittedTranslationClaim!;

    await prisma.translationClaim.update({
      where: { id: submittedClaim.id },
      data: {
        status: "approved",
        approved_at: new Date(),
      },
    });

    const nextClaim = await activateNextTranslationClaim(task);
    if (nextClaim) {
      updated = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    } else if (await isTranslationCoverageComplete(task)) {
      updated = await prisma.task.update({
        where: { id: taskId },
        data: {
          status: "completed",
          assignee_id: null,
          completed_at: new Date(),
        },
      });

      await unlockDownstreamTasksIfReady(task, reviewerId);
    } else {
      updated = await prisma.task.update({
        where: { id: taskId },
        data: {
          status: "review_approved",
          assignee_id: submittedClaim.user_id,
          completed_at: null,
        },
      });
    }
  } else {
    updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "completed",
        completed_at: new Date(),
      },
    });

    await unlockDownstreamTasksIfReady(task, reviewerId);
  }

  if (task.assignee_id && task.assignee_id !== reviewerId) {
    await notificationService.createNotification(task.assignee_id, "review_approved", {
      projectId: task.project_id,
      taskId,
      actorId: reviewerId,
      taskName: task.title,
      projectName: await getProjectDisplayName(task.project_id),
    });
  }

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_approved,
    title: "Task approved",
    description: `Task "${task.title}" was approved`,
    actor_id: reviewerId,
    metadata: { task_id: taskId, review_id: review.id },
  });

  await auditService.log({
    user_id: actorId || reviewerId,
    action: "task.approve",
    resource_type: "task",
    resource_id: taskId,
    new_value: updated,
  });

  return { task: updated, review };
}

export async function rejectTask(
  taskId: string,
  reviewerId: string,
  data: ReviewTaskInput,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot reject task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (task.status !== "submitted") {
    throw new AppError(
      `Task cannot be rejected. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  // Create review record with snapshot
  const review = await prisma.review.create({
    data: {
      project_id: task.project_id,
      task_id: taskId,
      reviewer_id: reviewerId,
      requester_id: task.assignee_id,
      status: ReviewStatus.rejected,
      comments: data.comments,
      line_comments: data.line_comments,
      completed_at: new Date(),
    },
  });

  // Store snapshot of current file versions if any exist
  const fileVersions = await prisma.fileVersion.findMany({
    where: {
      file: { project_id: task.project_id },
      is_current: true,
    },
    take: 10,
  });

  for (const fv of fileVersions) {
    await prisma.reviewSnapshot.create({
      data: {
        review_id: review.id,
        file_id: fv.file_id,
        version_number: fv.version_number,
        content: fv.storage_path, // Store path as reference
      },
    });
  }

  let updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "review_rejected",
    },
  });

  if (task.role === TaskRole.translation) {
    const submittedClaims = await prisma.translationClaim.findMany({
      where: {
        task: translationClaimScope(task),
        status: "submitted",
      },
      include: {
        task: {
          select: {
            translation_order: true,
            created_at: true,
          },
        },
      },
    });
    const submittedClaim = submittedClaims.sort(compareTranslationClaims)[0];

    if (submittedClaim) {
      await prisma.translationClaim.update({
        where: { id: submittedClaim.id },
        data: { status: "active" },
      });

      updated = await prisma.task.update({
        where: { id: taskId },
        data: {
          status: "assigned",
          assignee_id: submittedClaim.user_id,
          submitted_at: null,
        },
      });
    }
  }

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_rejected,
    title: "Task rejected",
    description: `Task "${task.title}" was rejected with review comments`,
    actor_id: reviewerId,
    metadata: { task_id: taskId, review_id: review.id },
  });

  if (task.assignee_id && task.assignee_id !== reviewerId) {
    await notificationService.createNotification(task.assignee_id, "review_rejected", {
      projectId: task.project_id,
      taskId,
      actorId: reviewerId,
      taskName: task.title,
      projectName: await getProjectDisplayName(task.project_id),
      reason: data.comments || undefined,
    });
  }

  await auditService.log({
    user_id: actorId || reviewerId,
    action: "task.reject",
    resource_type: "task",
    resource_id: taskId,
    new_value: updated,
  });

  return { task: updated, review };
}

export async function resetTask(
  taskId: string,
  actorId?: string,
  data?: ResetTaskInput
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot reset task in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (!(await canManageProjectTasks(task.project_id, actorId))) {
    throw new AppError("Only project supervisors can reset tasks", "FORBIDDEN", 403);
  }

  if (!TASK_MANUAL_RESET_STATUSES.includes(task.status)) {
    throw new AppError(
      `Task cannot be reset. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  const prerequisiteState = await getTaskPrerequisiteState(task);
  const resetStatus: TaskStatus = prerequisiteState.workflow.missing ? "pending_publish" : "in_progress";
  const updateData: Record<string, unknown> = {
    status: resetStatus,
    started_at: resetStatus === "in_progress" ? task.started_at || (task.assignee_id ? new Date() : null) : null,
    completed_at: null,
    submitted_at: null,
    cancelled_at: null,
    frozen_at: null,
  };

  // For release role, discard uploaded artifacts
  if (task.role === "release") {
    await discardReleaseArtifacts(task, actorId);
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: updateData,
  });

  // Cascade reset downstream tasks whose inputs are invalidated.
  await cascadeResetDownstream(taskId, actorId);

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_reset,
    title: "Task reset",
    description: `Task "${task.title}" was reset to ${resetStatus}${data?.reason ? `: ${data.reason}` : ""}`,
    actor_id: actorId,
    metadata: { task_id: taskId, reason: data?.reason },
  });

  await auditService.log({
    user_id: actorId,
    action: "task.reset",
    resource_type: "task",
    resource_id: taskId,
    old_value: task,
    new_value: updated,
  });

  return updated;
}

export async function updateTaskDeadline(
  taskId: string,
  data: UpdateTaskDeadlineInput,
  actorId?: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      due_date: new Date(data.due_date),
    },
  });

  await auditService.log({
    user_id: actorId,
    action: "task.update_deadline",
    resource_type: "task",
    resource_id: taskId,
    new_value: { due_date: data.due_date },
  });

  return updated;
}

// ==================== TRANSLATION SEGMENT CLAIMING ====================

export async function claimTranslationSegment(
  taskId: string,
  userId: string,
  data: ClaimSegmentInput
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { is_archived: true, deleted_at: true } },
      unit: { select: { episode_length: true } },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project.deleted_at || task.project.is_archived) {
    throw new AppError("Cannot claim segments in archived/deleted project", "BAD_REQUEST", 400);
  }

  if (task.role !== "translation") {
    throw new AppError(
      "Only translation tasks support segment claiming",
      "BAD_REQUEST",
      400
    );
  }

  if (!["claimable", "assigned", "in_progress", "submitted", "review_approved"].includes(task.status)) {
    throw new AppError(
      `Translation segments cannot be claimed. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  const prerequisiteState = await getTaskPrerequisiteState(task);
  if (!prerequisiteState.ready) {
    throw new AppError(
      getTaskPrerequisiteErrorMessage("claim translation segment", prerequisiteState),
      "DEPENDENCY_NOT_MET",
      400
    );
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: task.project_id,
        user_id: userId,
      },
    },
  });

  const canClaim =
    membership &&
    !membership.left_at &&
    (membership.role === "translation" || membership.role === "supervisor");

  if (!canClaim) {
    throw new AppError(
      "You must be a project translator to claim translation segments",
      "FORBIDDEN",
      403
    );
  }

  if (membership.role !== "supervisor" && task.assignee_id !== userId) {
    throw new AppError(
      "Only the assigned member can claim segments in this translation task",
      "FORBIDDEN",
      403
    );
  }

  if (membership.role !== "supervisor") {
    await assertTaskClaimRoleTagAccess(
      userId,
      task.project_id,
      "translation",
      "You need a granted translation role tag before claiming translation work"
    );
  }

  if (data.segment_start >= data.segment_end) {
    throw new AppError(
      "Segment end must be greater than segment start",
      "VALIDATION_ERROR",
      400
    );
  }

  const segmentLength = data.segment_end - data.segment_start;
  const maxSegmentLength = await getTaskRoleMaxSegmentLength(task.project_id, "translation");

  // Validate within episode length if available
  if (task.unit?.episode_length) {
    if (data.segment_end > task.unit.episode_length) {
      throw new AppError(
        `Segment end exceeds episode length (${task.unit.episode_length}s)`,
        "VALIDATION_ERROR",
        400
      );
    }
  }

  const activeClaimScope = task.unit_id
    ? { unit_id: task.unit_id }
    : { task_id: taskId };
  const userActiveClaims = await prisma.translationClaim.findMany({
    where: {
      ...activeClaimScope,
      user_id: userId,
      status: { in: RESERVED_TRANSLATION_CLAIM_STATUSES },
    },
    select: {
      segment_start: true,
      segment_end: true,
    },
  });
  const userClaimedSeconds = userActiveClaims.reduce(
    (sum, claim) => sum + Math.max(0, claim.segment_end - claim.segment_start),
    0
  );

  if (maxSegmentLength !== undefined && userClaimedSeconds + segmentLength > maxSegmentLength) {
    throw new AppError(
      `Total claimed translation duration exceeds maximum allowed ${maxSegmentLength}s`,
      "BAD_REQUEST",
      400
    );
  }

  const overlapping = await prisma.translationClaim.findFirst({
    where: {
      ...activeClaimScope,
      status: { in: [...RESERVED_TRANSLATION_CLAIM_STATUSES, "approved"] },
      AND: [
        { segment_start: { lt: data.segment_end } },
        { segment_end: { gt: data.segment_start } },
      ],
    },
  });

  if (overlapping) {
    throw new AppError(
      "These segments are already claimed",
      "CONFLICT",
      409
    );
  }

  const claim = await prisma.translationClaim.create({
    data: {
      task_id: taskId,
      unit_id: task.unit_id,
      user_id: userId,
      segment_start: data.segment_start,
      segment_end: data.segment_end,
      status: "pending",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  const activatedClaim = await activateNextTranslationClaim(task);

  // Check if all segments are claimed (if episode_length is known)
  if (task.unit?.episode_length) {
    const allClaims = await prisma.translationClaim.findMany({
      where: {
        ...activeClaimScope,
        status: { in: [...RESERVED_TRANSLATION_CLAIM_STATUSES, "approved"] },
      },
      orderBy: { segment_start: "asc" },
    });

    // Check for full coverage
    let covered = 0;
    let lastEnd = 0;
    for (const c of allClaims) {
      if (c.segment_start <= lastEnd) {
        covered += Math.max(0, c.segment_end - lastEnd);
        lastEnd = Math.max(lastEnd, c.segment_end);
      } else {
        covered += c.segment_end - c.segment_start;
        lastEnd = c.segment_end;
      }
    }

    if (covered >= task.unit.episode_length) {
      // Lock translation claiming for this unit once all time ranges are covered.
      await prisma.task.updateMany({
        where: task.unit_id
          ? {
              project_id: task.project_id,
              unit_id: task.unit_id,
              role: "translation",
              status: "claimable",
            }
          : { id: taskId },
        data: { status: "assigned" },
      });
    }
  }

  await auditService.log({
    user_id: userId,
    action: "translation.claim_segment",
    resource_type: "task",
    resource_id: taskId,
    new_value: activatedClaim?.id === claim.id
      ? { ...claim, status: "active" }
      : claim,
  });

  return activatedClaim?.id === claim.id ? activatedClaim : claim;
}

export async function abandonTranslationSegment(
  claimId: string,
  userId: string
) {
  const claim = await prisma.translationClaim.findUnique({
    where: { id: claimId },
    include: {
      task: {
        select: {
          project_id: true,
          unit_id: true,
          role: true,
        },
      },
    },
  });

  if (!claim) {
    throw new AppError("Claim not found", "NOT_FOUND", 404);
  }

  if (claim.user_id !== userId) {
    throw new AppError("You can only abandon your own claims", "FORBIDDEN", 403);
  }

  if (claim.status !== "active" && claim.status !== "pending") {
    throw new AppError("Claim cannot be abandoned", "BAD_REQUEST", 400);
  }

  const updated = await prisma.translationClaim.update({
    where: { id: claimId },
    data: {
      status: "abandoned",
    },
  });

  const next = await activateNextTranslationClaim({
    id: claim.task_id,
    project_id: claim.task.project_id,
    unit_id: claim.unit_id,
    title: "翻译任务",
  });

  if (!next) {
    await prisma.task.updateMany({
      where: {
        id: claim.task_id,
        assignee_id: userId,
      },
      data: { status: "claimable", assignee_id: null, started_at: null, submitted_at: null },
    });
  }

  await auditService.log({
    user_id: userId,
    action: "translation.abandon_segment",
    resource_type: "translation_claim",
    resource_id: claimId,
    old_value: claim,
    new_value: updated,
  });

  return updated;
}

export async function submitTranslation(
  taskId: string,
  userId: string,
  data: SubmitTranslationInput
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.role !== TaskRole.translation) {
    throw new AppError("Only translation tasks accept translation submissions", "BAD_REQUEST", 400);
  }

  const activeClaim = await prisma.translationClaim.findFirst({
    where: {
      task: translationClaimScope(task),
      user_id: userId,
      status: "active",
    },
  });

  if (!activeClaim) {
    throw new AppError(
      "Only the active translation segment can submit translation content",
      "FORBIDDEN",
      403
    );
  }

  const submittedAt = new Date();
  const submission = await prisma.translationSubmission.create({
    data: {
      task_id: taskId,
      user_id: userId,
      claim_id: activeClaim.id,
      content: data.content,
      line_count: data.line_count,
    },
  });

  // Update claim status if exists
  await prisma.translationClaim.update({
    where: {
      id: activeClaim.id,
    },
    data: {
      status: "submitted",
      submitted_at: submittedAt,
    },
  });

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "submitted",
      assignee_id: userId,
      submitted_at: submittedAt,
    },
  });

  await auditService.log({
    user_id: userId,
    action: "translation.submit",
    resource_type: "task",
    resource_id: taskId,
    new_value: submission,
  });

  return submission;
}

// ==================== DEPENDENCIES ====================

export async function createDependency(
  taskId: string,
  data: CreateDependencyInput
) {
  if (taskId === data.depends_on_id) {
    throw new AppError("A task cannot depend on itself", "BAD_REQUEST", 400);
  }

  const [task, dependsOn] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, project_id: true, status: true },
    }),
    prisma.task.findUnique({
      where: { id: data.depends_on_id },
      select: { id: true, project_id: true, status: true },
    }),
  ]);

  if (!task || !dependsOn) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project_id !== dependsOn.project_id) {
    throw new AppError("Task dependencies must belong to the same project", "BAD_REQUEST", 400);
  }

  if (
    dependsOn.status !== "completed" &&
    ["in_progress", "submitted", "review_approved", "completed", "overdue"].includes(task.status)
  ) {
    throw new AppError(
      "Cannot add an unmet dependency to an already-started task",
      "BAD_REQUEST",
      400
    );
  }

  const dependency = await prisma.taskDependency.create({
    data: {
      task_id: taskId,
      depends_on_id: data.depends_on_id,
      dependency_type: data.dependency_type,
    },
  });

  await reconcileTaskDependencyState(taskId);

  return dependency;
}

export async function removeDependency(
  taskId: string,
  dependencyId: string
) {
  await prisma.taskDependency.delete({
    where: {
      task_id_depends_on_id: {
        task_id: taskId,
        depends_on_id: dependencyId,
      },
    },
  });

  await reconcileTaskDependencyState(taskId);

  return { success: true };
}

// ==================== WORKLOAD DASHBOARD ====================

export async function getPersonalWorkload(userId: string) {
  const now = new Date();

  const [activeTasks, overdueTasks, completedTasks] = await Promise.all([
    prisma.task.findMany({
      where: {
        assignee_id: userId,
        status: { in: ["assigned", "in_progress", "submitted"] },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        unit: {
          select: {
            id: true,
            season_number: true,
            unit_number: true,
            title: true,
          },
        },
      },
      orderBy: { due_date: "asc" },
    }),
    prisma.task.findMany({
      where: {
        assignee_id: userId,
        status: { in: ["assigned", "in_progress", "submitted"] },
        due_date: { lt: now },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        unit: {
          select: {
            id: true,
            season_number: true,
            unit_number: true,
            title: true,
          },
        },
      },
      orderBy: { due_date: "asc" },
    }),
    prisma.task.count({
      where: {
        assignee_id: userId,
        status: "completed",
        completed_at: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
        },
      },
    }),
  ]);

  return {
    active: activeTasks,
    overdue: overdueTasks,
    completedThisMonth: completedTasks,
    stats: {
      totalActive: activeTasks.length,
      totalOverdue: overdueTasks.length,
    },
  };
}

export async function getProjectWorkload(projectId: string) {
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
  });

  const workload = await Promise.all(
    members.map(async (member) => {
      const tasks = await prisma.task.findMany({
        where: {
          project_id: projectId,
          assignee_id: member.user_id,
        },
        select: {
          status: true,
          role: true,
          due_date: true,
        },
      });

      const stats = {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending_publish").length,
        claimable: tasks.filter((t) => t.status === "claimable").length,
        assigned: tasks.filter((t) => t.status === "assigned").length,
        inProgress: tasks.filter((t) => t.status === "in_progress").length,
        submitted: tasks.filter((t) => t.status === "submitted").length,
        completed: tasks.filter((t) => t.status === "completed").length,
        overdue: tasks.filter(
          (t) =>
            t.due_date &&
            t.due_date < new Date() &&
            !["completed", "frozen"].includes(t.status)
        ).length,
      };

      return {
        member,
        tasks,
        stats,
      };
    })
  );

  return workload;
}

export async function getGlobalWorkload() {
  const users = await prisma.user.findMany({
    where: { status: "active" },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatar_url: true,
    },
  });

  const workload = await Promise.all(
    users.map(async (user) => {
      const tasks = await prisma.task.findMany({
        where: {
          assignee_id: user.id,
        },
        select: {
          status: true,
          project_id: true,
        },
      });

      const projectIds = [...new Set(tasks.map((t) => t.project_id))];

      return {
        user,
        stats: {
          totalProjects: projectIds.length,
          totalTasks: tasks.length,
          active: tasks.filter((t) =>
            ["assigned", "in_progress", "submitted"].includes(t.status)
          ).length,
          completed: tasks.filter((t) => t.status === "completed").length,
          overdue: tasks.filter(
            (t) => t.status === "overdue"
          ).length,
        },
      };
    })
  );

  return workload;
}
