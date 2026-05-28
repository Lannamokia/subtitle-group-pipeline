import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { TaskStatus, TaskRole, TimelineEventType, ReviewStatus } from "@prisma/client";
import * as auditService from "../audit/audit.service";
import * as timelineService from "../timeline/timeline.service";
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

/**
 * Cascade reset downstream completed/submitted tasks when a task is reset
 */
async function cascadeResetDownstream(
  taskId: string,
  actorId?: string
): Promise<void> {
  const downstream = await getDownstreamTasks(taskId);

  for (const downTask of downstream) {
    if (
      downTask.status === "completed" ||
      downTask.status === "submitted" ||
      downTask.status === "review_approved"
    ) {
      // For release role, discard uploaded artifacts
      if (downTask.role === "release") {
        // Mark associated file versions as non-current
        // (In a real system, you might delete or archive them)
      }

      const oldStatus = downTask.status;
      await prisma.task.update({
        where: { id: downTask.id },
        data: {
          status: "in_progress",
          completed_at: null,
          submitted_at: null,
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
    } else if (downTask.status === "in_progress") {
      warned.push(downTask.id);
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

  const task = await prisma.task.create({
    data: {
      project_id: data.project_id,
      unit_id: data.unit_id,
      title: data.title,
      description: data.description,
      role: data.role,
      assignee_id: data.assignee_id,
      creator_id: creatorId,
      due_date: data.due_date ? new Date(data.due_date) : null,
      status: data.assignee_id ? "assigned" : "pending_publish",
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
    metadata: { task_id: task.id, role: task.role },
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

  if (query.project_id) {
    where.project_id = query.project_id;
  }
  if (query.unit_id) {
    where.unit_id = query.unit_id;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.role) {
    where.role = query.role;
  }
  if (query.assignee_id) {
    where.assignee_id = query.assignee_id;
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
          },
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
  });

  if (!existing) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  await prisma.task.delete({
    where: { id: taskId },
  });

  await auditService.log({
    user_id: actorId,
    action: "task.delete",
    resource_type: "task",
    resource_id: taskId,
    old_value: existing,
  });

  return { success: true };
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

  // Check dependencies
  const depsMet = await checkDependenciesMet(taskId);
  if (!depsMet) {
    throw new AppError(
      "Cannot claim task: dependencies not met",
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

  // Check dependencies
  const depsMet = await checkDependenciesMet(taskId);
  if (!depsMet) {
    throw new AppError(
      "Cannot assign task: dependencies not met",
      "DEPENDENCY_NOT_MET",
      400
    );
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      assignee_id: assigneeId,
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
    event_type: TimelineEventType.task_assigned,
    title: "Task assigned",
    description: `Task "${task.title}" was assigned`,
    actor_id: actorId,
    metadata: { task_id: taskId, assignee_id: assigneeId },
  });

  await auditService.log({
    user_id: actorId,
    action: "task.assign",
    resource_type: "task",
    resource_id: taskId,
    new_value: updated,
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

  if (task.status !== "assigned" && task.status !== "in_progress") {
    throw new AppError(
      `Task cannot be returned. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  // Only the assignee can return the task (no approval needed)
  if (task.assignee_id !== userId) {
    throw new AppError("Only the assigned member can return this task", "FORBIDDEN", 403);
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      assignee_id: null,
      status: "claimable",
      started_at: null,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_returned,
    title: "Task returned",
    description: `Task "${task.title}" was returned to the pool`,
    actor_id: userId,
    metadata: { task_id: taskId },
  });

  await auditService.log({
    user_id: actorId || userId,
    action: "task.return",
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

  // Check dependencies
  const depsMet = await checkDependenciesMet(taskId);
  if (!depsMet) {
    throw new AppError(
      "Cannot start task: dependencies not met",
      "DEPENDENCY_NOT_MET",
      400
    );
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

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "submitted",
      submitted_at: new Date(),
    },
  });

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_submitted,
    title: "Task submitted for review",
    description: `Task "${task.title}" was submitted for review`,
    actor_id: userId,
    metadata: { task_id: taskId },
  });

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
    task.status === "frozen" ||
    task.status === "cancelled"
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

  // Create review record
  const review = await prisma.review.create({
    data: {
      project_id: task.project_id,
      task_id: taskId,
      reviewer_id: reviewerId,
      status: ReviewStatus.approved,
      comments: data.comments,
      line_comments: data.line_comments,
      completed_at: new Date(),
    },
  });

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "completed",
      completed_at: new Date(),
    },
  });

  // Unlock next stage: make the next task in pipeline claimable if dependencies are met
  const downstream = await getDownstreamTasks(taskId);
  for (const downTask of downstream) {
    const downDepsMet = await checkDependenciesMet(downTask.id);
    if (downDepsMet && downTask.status === "pending_publish") {
      await prisma.task.update({
        where: { id: downTask.id },
        data: { status: "claimable" },
      });
    }
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

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "review_rejected",
    },
  });

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_rejected,
    title: "Task rejected",
    description: `Task "${task.title}" was rejected with review comments`,
    actor_id: reviewerId,
    metadata: { task_id: taskId, review_id: review.id },
  });

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

  if (
    task.status !== "submitted" &&
    task.status !== "review_rejected" &&
    task.status !== "completed" &&
    task.status !== "review_approved"
  ) {
    throw new AppError(
      `Task cannot be reset. Current status: ${task.status}`,
      "BAD_REQUEST",
      400
    );
  }

  const updateData: Record<string, unknown> = {
    status: "in_progress",
    completed_at: null,
    submitted_at: null,
  };

  // For release role, discard uploaded artifacts
  if (task.role === "release") {
    // In a real system, you might delete or archive file versions
    // Here we just note it in the audit log
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: updateData,
  });

  // Cascade reset downstream completed/submitted tasks
  await cascadeResetDownstream(taskId, actorId);

  await timelineService.createTimelineEvent({
    project_id: task.project_id,
    event_type: TimelineEventType.task_reset,
    title: "Task reset",
    description: `Task "${task.title}" was reset to in_progress${data?.reason ? `: ${data.reason}` : ""}`,
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

  if (data.segment_start >= data.segment_end) {
    throw new AppError(
      "Segment end must be greater than segment start",
      "VALIDATION_ERROR",
      400
    );
  }

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

  // Check for overlapping claims
  const overlapping = await prisma.translationClaim.findFirst({
    where: {
      task_id: taskId,
      status: { in: ["pending", "active"] },
      OR: [
        {
          segment_start: { lte: data.segment_start },
          segment_end: { gte: data.segment_start },
        },
        {
          segment_start: { lte: data.segment_end },
          segment_end: { gte: data.segment_end },
        },
        {
          segment_start: { gte: data.segment_start },
          segment_end: { lte: data.segment_end },
        },
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

  // Check per-user max segment limit (default: 3 segments per task per user)
  const userClaimCount = await prisma.translationClaim.count({
    where: {
      task_id: taskId,
      user_id: userId,
      status: { in: ["pending", "active"] },
    },
  });

  if (userClaimCount >= 3) {
    throw new AppError(
      "You have reached the maximum number of segments (3) for this task",
      "BAD_REQUEST",
      400
    );
  }

  const claim = await prisma.translationClaim.create({
    data: {
      task_id: taskId,
      user_id: userId,
      segment_start: data.segment_start,
      segment_end: data.segment_end,
      status: "active",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // Check if all segments are claimed (if episode_length is known)
  if (task.unit?.episode_length) {
    const totalClaimed = await prisma.translationClaim.aggregate({
      where: {
        task_id: taskId,
        status: { in: ["pending", "active"] },
      },
      _sum: {
        segment_end: true,
      },
    });

    // Simple check: if total claimed segments cover the full episode
    const allClaims = await prisma.translationClaim.findMany({
      where: {
        task_id: taskId,
        status: { in: ["pending", "active"] },
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
      // Lock the task - all segments claimed
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "assigned" },
      });
    }
  }

  await auditService.log({
    user_id: userId,
    action: "translation.claim_segment",
    resource_type: "task",
    resource_id: taskId,
    new_value: claim,
  });

  return claim;
}

export async function abandonTranslationSegment(
  claimId: string,
  userId: string
) {
  const claim = await prisma.translationClaim.findUnique({
    where: { id: claimId },
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

  const submission = await prisma.translationSubmission.create({
    data: {
      task_id: taskId,
      user_id: userId,
      content: data.content,
      line_count: data.line_count,
    },
  });

  // Update claim status if exists
  await prisma.translationClaim.updateMany({
    where: {
      task_id: taskId,
      user_id: userId,
      status: "active",
    },
    data: {
      status: "submitted",
      submitted_at: new Date(),
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

  const dependency = await prisma.taskDependency.create({
    data: {
      task_id: taskId,
      depends_on_id: data.depends_on_id,
      dependency_type: data.dependency_type,
    },
  });

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
