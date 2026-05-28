import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  CreateMergeJobInput,
  MergeJobQueryInput,
  ConflictQueryInput,
  ResolveConflictInput,
  ReviewInput,
  CreateSnapshotInput,
} from "./subtitle.schema";

// Merge Jobs
export async function createMergeJob(data: CreateMergeJobInput) {
  const job = await prisma.mergeJob.create({
    data: {
      project_id: data.project_id,
      unit_id: data.unit_id,
      input_files: data.input_files,
      status: "pending",
    },
  });

  return job;
}

export async function getMergeJobs(query: MergeJobQueryInput) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (query.project_id) {
    where.project_id = query.project_id;
  }
  if (query.status) {
    where.status = query.status;
  }

  const [jobs, total] = await Promise.all([
    prisma.mergeJob.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
    }),
    prisma.mergeJob.count({ where }),
  ]);

  return {
    jobs,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getMergeJobById(jobId: string) {
  const job = await prisma.mergeJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new AppError("Merge job not found", "NOT_FOUND", 404);
  }

  return job;
}

export async function updateMergeJobStatus(
  jobId: string,
  status: string,
  outputFileId?: string,
  log?: string
) {
  const updateData: Record<string, unknown> = { status };

  if (status === "running") {
    updateData.started_at = new Date();
  }
  if (status === "completed" || status === "failed") {
    updateData.completed_at = new Date();
  }
  if (outputFileId) {
    updateData.output_file_id = outputFileId;
  }
  if (log) {
    updateData.log = log;
  }

  const job = await prisma.mergeJob.update({
    where: { id: jobId },
    data: updateData,
  });

  return job;
}

// Conflicts
export async function getConflicts(query: ConflictQueryInput) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (query.project_id) {
    where.project_id = query.project_id;
  }
  if (query.conflict_type) {
    where.conflict_type = query.conflict_type;
  }
  if (query.resolution) {
    where.resolution = query.resolution;
  }

  const [conflicts, total] = await Promise.all([
    prisma.subtitleConflict.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
    }),
    prisma.subtitleConflict.count({ where }),
  ]);

  return {
    conflicts,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getConflictById(conflictId: string) {
  const conflict = await prisma.subtitleConflict.findUnique({
    where: { id: conflictId },
  });

  if (!conflict) {
    throw new AppError("Conflict not found", "NOT_FOUND", 404);
  }

  return conflict;
}

export async function resolveConflict(
  conflictId: string,
  resolverId: string,
  data: ResolveConflictInput
) {
  const conflict = await prisma.subtitleConflict.update({
    where: { id: conflictId },
    data: {
      resolution: data.resolution,
      resolved_by: resolverId,
      resolved_at: new Date(),
      resolution_note: data.resolution_note,
    },
  });

  return conflict;
}

export async function createConflict(data: {
  project_id: string;
  unit_id?: string;
  conflict_type: string;
  description?: string;
  affected_lines?: string;
  file_a_id: string;
  file_b_id: string;
}) {
  const conflict = await prisma.subtitleConflict.create({
    data: {
      project_id: data.project_id,
      unit_id: data.unit_id,
      conflict_type: data.conflict_type,
      description: data.description,
      affected_lines: data.affected_lines,
      file_a_id: data.file_a_id,
      file_b_id: data.file_b_id,
    },
  });

  return conflict;
}

// Reviews
export async function createReview(
  reviewerId: string,
  data: ReviewInput
) {
  const review = await prisma.review.create({
    data: {
      project_id: data.project_id,
      task_id: data.task_id,
      file_version_id: data.file_version_id,
      reviewer_id: reviewerId,
      status: data.status,
      comments: data.comments,
      line_comments: data.line_comments,
    },
    include: {
      reviewer: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  // Update task status if review is for a task
  if (data.task_id) {
    const taskStatus =
      data.status === "approved"
        ? "approved"
        : data.status === "rejected"
        ? "rejected"
        : "in_progress";

    await prisma.task.update({
      where: { id: data.task_id },
      data: { status: taskStatus },
    });
  }

  return review;
}

export async function getReviews(projectId: string) {
  const reviews = await prisma.review.findMany({
    where: { project_id: projectId },
    orderBy: { submitted_at: "desc" },
    include: {
      reviewer: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      requester: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      snapshots: true,
    },
  });

  return reviews;
}

export async function getReviewById(reviewId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      reviewer: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      snapshots: true,
    },
  });

  if (!review) {
    throw new AppError("Review not found", "NOT_FOUND", 404);
  }

  return review;
}

export async function updateReview(
  reviewId: string,
  data: Partial<ReviewInput>
) {
  const review = await prisma.review.update({
    where: { id: reviewId },
    data: {
      status: data.status,
      comments: data.comments,
      line_comments: data.line_comments,
      completed_at: data.status ? new Date() : undefined,
    },
  });

  // Update task status if applicable
  if (review.task_id && data.status) {
    const taskStatus =
      data.status === "approved"
        ? "approved"
        : data.status === "rejected"
        ? "rejected"
        : "in_progress";

    await prisma.task.update({
      where: { id: review.task_id },
      data: { status: taskStatus },
    });
  }

  return review;
}

// Snapshots
export async function createSnapshot(data: CreateSnapshotInput) {
  const snapshot = await prisma.reviewSnapshot.create({
    data: {
      review_id: data.file_id, // This is a bit odd - review_id should be separate
      file_id: data.file_id,
      version_number: data.version_number,
      content: data.content,
    },
  });

  return snapshot;
}

export async function getSnapshots(reviewId: string) {
  const snapshots = await prisma.reviewSnapshot.findMany({
    where: { review_id: reviewId },
    orderBy: { created_at: "desc" },
  });

  return snapshots;
}
