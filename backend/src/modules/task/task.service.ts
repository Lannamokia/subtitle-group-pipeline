import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  TaskQueryInput,
  ClaimSegmentInput,
  SubmitTranslationInput,
  CreateDependencyInput,
} from "./task.schema";

export async function createTask(creatorId: string, data: CreateTaskInput) {
  const project = await prisma.project.findUnique({
    where: { id: data.project_id },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
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
      status: data.assignee_id ? "in_progress" : "not_started",
      started_at: data.assignee_id ? new Date() : null,
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
      },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  return task;
}

export async function updateTask(taskId: string, data: UpdateTaskInput) {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!existing) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.assignee_id !== undefined) updateData.assignee_id = data.assignee_id;
  if (data.due_date !== undefined) {
    updateData.due_date = data.due_date ? new Date(data.due_date) : null;
  }

  // Auto-set started_at when assigned
  if (data.assignee_id && !existing.assignee_id) {
    updateData.started_at = new Date();
    if (existing.status === "not_started") {
      updateData.status = "in_progress";
    }
  }

  // Auto-set completed_at when status changes to approved
  if (data.status === "approved" && existing.status !== "approved") {
    updateData.completed_at = new Date();
  }

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

  return task;
}

export async function deleteTask(taskId: string) {
  await prisma.task.delete({
    where: { id: taskId },
  });

  return { success: true };
}

export async function claimSegment(
  taskId: string,
  userId: string,
  data: ClaimSegmentInput
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.role !== "translator") {
    throw new AppError(
      "Only translation tasks support segment claiming",
      "BAD_REQUEST",
      400
    );
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
      user_id: userId,
      segment_start: data.segment_start,
      segment_end: data.segment_end,
      status: "active",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    },
  });

  return claim;
}

export async function submitTranslation(
  taskId: string,
  userId: string,
  data: SubmitTranslationInput
) {
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

  // Update task status
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "pending_review" },
  });

  return submission;
}

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
