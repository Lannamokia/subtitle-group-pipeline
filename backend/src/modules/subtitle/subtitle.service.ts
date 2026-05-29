import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import {
  parseASS,
  generateASS,
  isExactDuplicate,
  hasTextConflict,
  hasOverlapConflict,
  type ASSLine,
  type ASSParseResult,
} from "./ass-parser";
import type {
  CreateMergeJobInput,
  MergeJobQueryInput,
  ConflictQueryInput,
  ResolveConflictInput,
  ReviewInput,
  CreateSnapshotInput,
  CreateTranslationClaimInput,
  SubmitTranslationInput,
  CompareVersionsInput,
} from "./subtitle.schema";
import * as fileService from "../file/file.service";
import * as storageService from "../storage/storage.service";
import * as notificationService from "../notification/notification.service";
import { createHash, randomUUID } from "crypto";
import type { ConflictType } from "@prisma/client";

// ==================== TRANSLATION CLAIMS ====================

export async function createTranslationClaim(
  projectUnitId: string,
  userId: string,
  data: CreateTranslationClaimInput
) {
  const unit = await prisma.projectUnit.findUnique({
    where: { id: projectUnitId },
    include: {
      project: {
        include: {
          template: true,
        },
      },
    },
  });

  if (!unit) {
    throw new AppError("Project unit not found", "NOT_FOUND", 404);
  }

  // Validate start < end
  if (data.start_time >= data.end_time) {
    throw new AppError("Start time must be less than end time", "BAD_REQUEST", 400);
  }

  // Validate within episode_length
  if (unit.episode_length !== null && unit.episode_length !== undefined) {
    if (data.start_time < 0 || data.end_time > unit.episode_length) {
      throw new AppError(
        `Claim must be within episode length (${unit.episode_length}s)`,
        "BAD_REQUEST",
        400
      );
    }
  }

  // Validate no overlap with existing active claims
  const overlapping = await prisma.translationClaim.findFirst({
    where: {
      unit_id: projectUnitId,
      status: { in: ["pending", "active"] },
      OR: [
        {
          segment_start: { lte: data.start_time },
          segment_end: { gt: data.start_time },
        },
        {
          segment_start: { lt: data.end_time },
          segment_end: { gte: data.end_time },
        },
        {
          segment_start: { gte: data.start_time },
          segment_end: { lte: data.end_time },
        },
      ],
    },
  });

  if (overlapping) {
    throw new AppError(
      "This time segment overlaps with an existing claim",
      "CONFLICT",
      409
    );
  }

  // Validate per-user max segment limit from template
  const templateRoles = unit.project.template
    ? JSON.parse(unit.project.template.roles || "[]")
    : [];
  const translationRole = templateRoles.find(
    (r: Record<string, unknown>) => r.role === "translation"
  );
  const maxSegments = translationRole?.maxSegmentsPerUser ?? 3;

  const userActiveClaimCount = await prisma.translationClaim.count({
    where: {
      unit_id: projectUnitId,
      user_id: userId,
      status: { in: ["pending", "active"] },
    },
  });

  if (userActiveClaimCount >= maxSegments) {
    throw new AppError(
      `You have reached the maximum number of active claims (${maxSegments}) for this unit`,
      "FORBIDDEN",
      403
    );
  }

  // Find or create a translation task for this unit
  let task = await prisma.task.findFirst({
    where: {
      unit_id: projectUnitId,
      role: "translation",
    },
  });

  if (!task) {
    task = await prisma.task.create({
      data: {
        project_id: unit.project_id,
        unit_id: projectUnitId,
        title: `Translation - ${unit.title || `Unit ${unit.unit_number}`}`,
        role: "translation",
        creator_id: userId,
        status: "claimable",
      },
    });
  }

  const claim = await prisma.translationClaim.create({
    data: {
      task_id: task.id,
      unit_id: projectUnitId,
      user_id: userId,
      segment_start: data.start_time,
      segment_end: data.end_time,
      status: "active",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
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
        },
      },
    },
  });

  // Check if all segments are claimed (simple heuristic: total claimed time >= episode length)
  if (unit.episode_length) {
    const activeClaims = await prisma.translationClaim.findMany({
      where: {
        unit_id: projectUnitId,
        status: { in: ["pending", "active"] },
      },
      select: {
        segment_start: true,
        segment_end: true,
      },
    });

    // Merge all claimed intervals and check coverage
    const intervals = activeClaims.map((c) => ({
      start: c.segment_start,
      end: c.segment_end,
    }));
    intervals.sort((a, b) => a.start - b.start);

    let covered = 0;
    let currentStart = intervals[0]?.start ?? 0;
    let currentEnd = intervals[0]?.end ?? 0;

    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i].start <= currentEnd) {
        currentEnd = Math.max(currentEnd, intervals[i].end);
      } else {
        covered += currentEnd - currentStart;
        currentStart = intervals[i].start;
        currentEnd = intervals[i].end;
      }
    }
    covered += currentEnd - currentStart;

    if (covered >= unit.episode_length * 0.95) {
      // Lock claiming by updating task status
      await prisma.task.updateMany({
        where: {
          unit_id: projectUnitId,
          role: "translation",
          status: "claimable",
        },
        data: { status: "assigned" },
      });
    }
  }

  return claim;
}

export async function releaseTranslationClaim(claimId: string, userId: string) {
  const claim = await prisma.translationClaim.findUnique({
    where: { id: claimId },
  });

  if (!claim) {
    throw new AppError("Claim not found", "NOT_FOUND", 404);
  }

  if (claim.user_id !== userId) {
    throw new AppError("You can only release your own claims", "FORBIDDEN", 403);
  }

  if (claim.status !== "active" && claim.status !== "pending") {
    throw new AppError(
      "Cannot release a claim that is not active",
      "BAD_REQUEST",
      400
    );
  }

  const updated = await prisma.translationClaim.update({
    where: { id: claimId },
    data: {
      status: "abandoned",
    },
  });

  // Re-open the task for claiming if it was locked
  await prisma.task.updateMany({
    where: {
      id: claim.task_id,
      status: "assigned",
    },
    data: { status: "claimable" },
  });

  return updated;
}

export async function getTranslationClaims(projectUnitId: string) {
  const claims = await prisma.translationClaim.findMany({
    where: { unit_id: projectUnitId },
    orderBy: { segment_start: "asc" },
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
        },
      },
    },
  });

  return claims;
}

export async function getTranslationClaimById(claimId: string) {
  const claim = await prisma.translationClaim.findUnique({
    where: { id: claimId },
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
        },
      },
      submissions: true,
    },
  });

  if (!claim) {
    throw new AppError("Claim not found", "NOT_FOUND", 404);
  }

  return claim;
}

// ==================== TRANSLATION SUBMISSIONS ====================

export async function submitTranslation(
  taskId: string,
  userId: string,
  data: SubmitTranslationInput
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      unit: true,
      project: {
        select: {
          storage_backend_id: true,
        },
      },
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  // Find the user's active claim for this task
  const claim = await prisma.translationClaim.findFirst({
    where: {
      task_id: taskId,
      user_id: userId,
      status: { in: ["active", "pending"] },
    },
  });

  if (!claim) {
    throw new AppError(
      "You must have an active claim to submit a translation",
      "FORBIDDEN",
      403
    );
  }

  // If ASS content is provided, create a file entity for it
  let fileVersionId: string | null = null;

  if (data.ass_content) {
    let parsed: ASSParseResult;
    try {
      parsed = parseASS(data.ass_content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(`Invalid ASS submission: ${message}`, "VALIDATION_ERROR", 400);
    }

    if (parsed.lines.length === 0) {
      throw new AppError(
        "Invalid ASS submission: no dialogue lines found",
        "VALIDATION_ERROR",
        400
      );
    }

    // Create a new FileEntity for the ASS submission
    const fileName = `translation_${taskId}_${Date.now()}.ass`;
    const backend = task.project.storage_backend_id
      ? await prisma.storageBackend.findUnique({ where: { id: task.project.storage_backend_id } })
      : await storageService.getDefaultBackend();

    if (!backend || !backend.is_active) {
      throw new AppError("No active storage backend configured", "CONFIG_ERROR", 500);
    }

    const uploadResult = await storageService.uploadFile(
      backend.id,
      task.project_id,
      Buffer.from(data.ass_content, "utf-8"),
      fileName,
      "application/x-ass"
    );

    const file = await fileService.createFile(userId, {
      project_id: task.project_id,
      name: fileName,
      file_type: "subtitle",
      mime_type: "application/x-ass",
      size_bytes: uploadResult.size,
      storage_path: uploadResult.storagePath,
      storage_backend_id: backend.id,
      checksum: null,
      metadata: JSON.stringify({
        task_id: taskId,
        claim_id: claim.id,
        unit_id: task.unit_id,
        submission_type: "translation",
        parsed_line_count: parsed.lines.length,
      }),
    });

    // Get the initial version
    const versions = await prisma.fileVersion.findMany({
      where: { file_id: file.id },
      orderBy: { version_number: "desc" },
      take: 1,
    });

    fileVersionId = versions[0]?.id ?? null;
  }

  // Create the submission record
  const submission = await prisma.translationSubmission.create({
    data: {
      task_id: taskId,
      user_id: userId,
      claim_id: claim.id,
      file_version_id: fileVersionId,
      content: data.content || data.ass_content || "",
      line_count: data.line_count,
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      claim: true,
    },
  });

  // Update claim status
  await prisma.translationClaim.update({
    where: { id: claim.id },
    data: {
      status: "submitted",
      submitted_at: new Date(),
    },
  });

  // Update task status
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "submitted" },
  });

  return submission;
}

export async function getSubmissionsByTask(taskId: string) {
  const submissions = await prisma.translationSubmission.findMany({
    where: { task_id: taskId },
    orderBy: { submitted_at: "desc" },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      claim: true,
    },
  });

  return submissions;
}

// ==================== MERGE JOBS ====================

export async function createMergeJob(
  projectUnitId: string,
  claimIds: string[],
  userId: string
) {
  const unit = await prisma.projectUnit.findUnique({
    where: { id: projectUnitId },
    include: {
      project: true,
    },
  });

  if (!unit) {
    throw new AppError("Project unit not found", "NOT_FOUND", 404);
  }

  // Get all approved translation submissions for the specified claims
  const claims = await prisma.translationClaim.findMany({
    where: {
      id: { in: claimIds },
      unit_id: projectUnitId,
      status: { in: ["submitted", "approved"] },
    },
    include: {
      submissions: {
        include: {
          claim: true,
        },
      },
    },
  });

  if (claims.length === 0) {
    throw new AppError(
      "No valid claims found for merging",
      "BAD_REQUEST",
      400
    );
  }

  // Collect file version IDs from submissions
  const fileVersionIds: string[] = [];
  for (const claim of claims) {
    for (const sub of claim.submissions) {
      if (sub.file_version_id) {
        fileVersionIds.push(sub.file_version_id);
      }
    }
  }

  // Create merge job
  const job = await prisma.mergeJob.create({
    data: {
      project_id: unit.project_id,
      unit_id: projectUnitId,
      input_files: JSON.stringify(fileVersionIds),
      status: "pending",
    },
  });

  // Trigger async merge process (fire and forget)
  processMergeJob(job.id).catch((err) => {
    console.error(`Merge job ${job.id} failed:`, err);
  });

  return job;
}

export async function processMergeJob(jobId: string) {
  const job = await prisma.mergeJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new AppError("Merge job not found", "NOT_FOUND", 404);
  }

  if (job.status === "running" || job.status === "completed") {
    throw new AppError("Merge job is already processed", "BAD_REQUEST", 400);
  }

  // Update status to running
  await prisma.mergeJob.update({
    where: { id: jobId },
    data: {
      status: "running",
      started_at: new Date(),
    },
  });

  try {
    const fileVersionIds: string[] = JSON.parse(job.input_files);
    const allLines: Array<ASSLine & { sourceFileId: string }> = [];
    const conflicts: Array<{
      type: "exact_duplicate" | "text_conflict" | "overlap";
      lineA: (ASSLine & { sourceFileId: string });
      lineB: (ASSLine & { sourceFileId: string });
    }> = [];

    // Parse all submitted ASS files
    for (const fileVersionId of fileVersionIds) {
      const fileVersion = await prisma.fileVersion.findUnique({
        where: { id: fileVersionId },
        include: {
          file: true,
        },
      });

      if (!fileVersion) continue;

      // In a real system, we'd read the file from storage
      // For this implementation, we try to get content from the submission
      const submission = await prisma.translationSubmission.findFirst({
        where: { file_version_id: fileVersionId },
      });

      if (!submission || !submission.content) continue;

      // Check if content is valid ASS
      let parsed: ASSParseResult;
      try {
        parsed = parseASS(submission.content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new AppError(
          `Unable to parse ASS input ${fileVersionId}: ${message}`,
          "VALIDATION_ERROR",
          400
        );
      }

      if (parsed.lines.length === 0) {
        throw new AppError(
          `Unable to parse ASS input ${fileVersionId}: no dialogue lines found`,
          "VALIDATION_ERROR",
          400
        );
      }

      for (const line of parsed.lines) {
        allLines.push({ ...line, sourceFileId: fileVersion.file_id });
      }
    }

    if (allLines.length === 0) {
      throw new AppError(
        "No parseable ASS dialogue lines found in merge inputs",
        "VALIDATION_ERROR",
        400
      );
    }

    // Sort by start time
    allLines.sort((a, b) => a.startTime - b.startTime);

    // Deduplicate and detect conflicts
    const mergedLines: Array<ASSLine & { sourceFileId: string }> = [];
    const processed = new Set<number>();

    for (let i = 0; i < allLines.length; i++) {
      if (processed.has(i)) continue;

      const lineA = allLines[i];
      let keepLine = lineA;
      let hasConflict = false;

      for (let j = i + 1; j < allLines.length; j++) {
        if (processed.has(j)) continue;
        const lineB = allLines[j];

        // Check for exact duplicate
        if (isExactDuplicate(lineA, lineB)) {
          processed.add(j);
          conflicts.push({
            type: "exact_duplicate",
            lineA,
            lineB,
          });
          // Keep one (lineA)
        }
        // Check for text conflict
        else if (hasTextConflict(lineA, lineB)) {
          hasConflict = true;
          conflicts.push({
            type: "text_conflict",
            lineA,
            lineB,
          });
        }
        // Check for overlap conflict
        else if (hasOverlapConflict(lineA, lineB)) {
          hasConflict = true;
          conflicts.push({
            type: "overlap",
            lineA,
            lineB,
          });
        }
      }

      if (!hasConflict || keepLine) {
        mergedLines.push(keepLine);
      }
      processed.add(i);
    }

    // Re-sort merged lines
    mergedLines.sort((a, b) => a.startTime - b.startTime);

    // Generate merged ASS content
    // Use the first file's script info and styles as base
    let scriptInfo: ASSParseResult["scriptInfo"] = {
      Title: "Merged Subtitle",
      ScriptType: "v4.00+",
    };
    let styles: ASSParseResult["styles"] = [];

    if (fileVersionIds.length > 0) {
      const firstSubmission = await prisma.translationSubmission.findFirst({
        where: { file_version_id: fileVersionIds[0] },
      });
      if (firstSubmission?.content) {
        try {
          const firstParsed = parseASS(firstSubmission.content);
          scriptInfo = firstParsed.scriptInfo;
          styles = firstParsed.styles;
        } catch {
          // Use defaults
        }
      }
    }

    const mergedContent = generateASS(
      scriptInfo,
      styles,
      mergedLines.map((l, idx) => ({ ...l, id: `merged_${idx}` }))
    );

    // Save merged result as NEW independent FileEntity
    const mergedFileName = `merged_${job.unit_id}_${Date.now()}.ass`;
    const project = await prisma.project.findUnique({
      where: { id: job.project_id },
      select: {
        name: true,
        owner_id: true,
        storage_backend_id: true,
      },
    });

    if (!project) {
      throw new AppError("Project not found", "NOT_FOUND", 404);
    }

    const backend = project.storage_backend_id
      ? await prisma.storageBackend.findUnique({ where: { id: project.storage_backend_id } })
      : await storageService.getDefaultBackend();

    if (!backend || !backend.is_active) {
      throw new AppError("No active storage backend configured", "CONFIG_ERROR", 500);
    }

    const mergedUpload = await storageService.uploadFile(
      backend.id,
      job.project_id,
      Buffer.from(mergedContent, "utf-8"),
      mergedFileName,
      "application/x-ass"
    );

    const mergedFile = await fileService.createFile(
      project.owner_id,
      {
        project_id: job.project_id,
        name: mergedFileName,
        file_type: "subtitle",
        mime_type: "application/x-ass",
        size_bytes: mergedUpload.size,
        storage_path: mergedUpload.storagePath,
        storage_backend_id: backend.id,
        checksum: null,
        metadata: JSON.stringify({
          merge_job_id: job.id,
          unit_id: job.unit_id,
          source_file_count: fileVersionIds.length,
          merged_line_count: mergedLines.length,
          conflict_count: conflicts.length,
        }),
      }
    );

    // Get the version
    const versions = await prisma.fileVersion.findMany({
      where: { file_id: mergedFile.id },
      orderBy: { version_number: "desc" },
      take: 1,
    });

    const mergedFileVersionId = versions[0]?.id;

    // Create SubtitleConflict records for unresolved conflicts
    const unresolvedConflicts = conflicts.filter(
      (c) => c.type === "text_conflict" || c.type === "overlap"
    );

    for (const conflict of unresolvedConflicts) {
      await prisma.subtitleConflict.create({
        data: {
          project_id: job.project_id,
          unit_id: job.unit_id,
          conflict_type:
            conflict.type === "text_conflict"
              ? "content_mismatch"
              : "timing_conflict",
          description: `${conflict.type}: ${conflict.lineA.text} vs ${conflict.lineB.text}`,
          affected_lines: JSON.stringify([
            conflict.lineA.startTime,
            conflict.lineA.endTime,
          ]),
          file_a_id: conflict.lineA.sourceFileId,
          file_b_id: conflict.lineB.sourceFileId,
          resolution: "unresolved",
        },
      });
    }

    // Update merge job status
    const updatedJob = await prisma.mergeJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        output_file_id: mergedFile.id,
        completed_at: new Date(),
        log: JSON.stringify({
          total_lines: allLines.length,
          merged_lines: mergedLines.length,
          exact_duplicates: conflicts.filter((c) => c.type === "exact_duplicate").length,
          text_conflicts: conflicts.filter((c) => c.type === "text_conflict").length,
          overlap_conflicts: conflicts.filter((c) => c.type === "overlap").length,
        }),
      },
    });

    const notificationType = unresolvedConflicts.length > 0 ? "conflict_detected" : "project_update";
    const recipients = await notificationService.resolveRecipients(notificationType, {
      projectId: job.project_id,
      actorId: notificationType === "project_update" ? project.owner_id : undefined,
    });
    await notificationService.createBulkNotifications(recipients, notificationType, {
      projectId: job.project_id,
      actorId: notificationType === "project_update" ? project.owner_id : undefined,
      projectName: project.name,
      fileName: mergedFileName,
      reason: unresolvedConflicts.length > 0
        ? `检测到 ${unresolvedConflicts.length} 个未解决字幕冲突`
        : "字幕合并已完成",
    });

    return updatedJob;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.mergeJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        completed_at: new Date(),
        log: errorMessage,
      },
    });

    throw new AppError(
      `Merge job failed: ${errorMessage}`,
      "INTERNAL_ERROR",
      500
    );
  }
}

export async function getMergeJobStatus(jobId: string) {
  const job = await prisma.mergeJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new AppError("Merge job not found", "NOT_FOUND", 404);
  }

  let logData: Record<string, unknown> | null = null;
  if (job.log) {
    try {
      logData = JSON.parse(job.log);
    } catch {
      logData = { message: job.log };
    }
  }

  return {
    ...job,
    parsed_log: logData,
  };
}

export async function getMergeConflicts(jobId: string) {
  const job = await prisma.mergeJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new AppError("Merge job not found", "NOT_FOUND", 404);
  }

  const conflicts = await prisma.subtitleConflict.findMany({
    where: {
      project_id: job.project_id,
      unit_id: job.unit_id,
      resolution: "unresolved",
    },
    orderBy: { created_at: "desc" },
  });

  return conflicts;
}

// Legacy merge job functions
export async function createMergeJobLegacy(data: CreateMergeJobInput) {
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

type SourceSubtitle = {
  fileId: string;
  content: string | null;
};

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseConflictRange(affectedLines: string | null): { start: number; end: number } | null {
  const values = safeJsonParse<unknown>(affectedLines, null);
  if (!Array.isArray(values) || values.length < 2) {
    return null;
  }

  const [start, end] = values;
  if (typeof start !== "number" || typeof end !== "number") {
    return null;
  }

  return { start, end };
}

function overlapsRange(line: ASSLine, range: { start: number; end: number }): boolean {
  return line.startTime < range.end && range.start < line.endTime;
}

async function getCurrentSubtitleContent(fileId: string): Promise<SourceSubtitle> {
  const current = await prisma.fileVersion.findFirst({
    where: { file_id: fileId, is_current: true },
    orderBy: { version_number: "desc" },
  });
  const version = current || await prisma.fileVersion.findFirst({
    where: { file_id: fileId },
    orderBy: { version_number: "desc" },
  });

  if (!version) {
    return { fileId, content: null };
  }

  const submission = await prisma.translationSubmission.findFirst({
    where: { file_version_id: version.id },
    orderBy: { submitted_at: "desc" },
  });

  return {
    fileId,
    content: submission?.content || null,
  };
}

function buildResolvedSubtitleContent(
  conflict: {
    affected_lines: string | null;
    file_a_id: string;
    file_b_id: string;
  },
  sourceA: SourceSubtitle,
  sourceB: SourceSubtitle,
  resolutionText: string | null,
  keepFileId?: string
): { content: string; lineCount: number } {
  const preferred = keepFileId === conflict.file_b_id ? sourceB : sourceA;
  const fallback = preferred.content ? preferred : sourceA.content ? sourceA : sourceB;
  const range = parseConflictRange(conflict.affected_lines);

  let scriptInfo: ASSParseResult["scriptInfo"] = {
    Title: "Resolved Merged Subtitle",
    ScriptType: "v4.00+",
  };
  let styles: ASSParseResult["styles"] = [];
  let baseLines: ASSLine[] = [];

  if (fallback.content) {
    try {
      const parsed = parseASS(fallback.content);
      scriptInfo = parsed.scriptInfo;
      styles = parsed.styles;
      baseLines = parsed.lines;
    } catch {
      baseLines = [];
    }
  }

  const keptLines = range
    ? baseLines.filter((line) => !overlapsRange(line, range))
    : [...baseLines];

  let resolvedLines: ASSLine[] = [];
  if (resolutionText && !resolutionText.startsWith("keepTranslationId:")) {
    resolvedLines = [{
      id: `resolved_${randomUUID()}`,
      layer: 0,
      startTime: range?.start ?? baseLines[0]?.startTime ?? 0,
      endTime: range?.end ?? baseLines[0]?.endTime ?? 5,
      style: baseLines[0]?.style || "Default",
      name: "",
      marginL: 0,
      marginR: 0,
      marginV: 0,
      effect: "",
      text: resolutionText,
    }];
  } else if (range) {
    const keptSource = keepFileId === conflict.file_b_id ? sourceB : sourceA;
    if (keptSource.content) {
      try {
        resolvedLines = parseASS(keptSource.content).lines.filter((line) => overlapsRange(line, range));
      } catch {
        resolvedLines = [];
      }
    }
  }

  if (resolvedLines.length === 0 && range) {
    resolvedLines = baseLines.filter((line) => overlapsRange(line, range));
  }

  const mergedLines = [...keptLines, ...resolvedLines]
    .sort((a, b) => a.startTime - b.startTime)
    .map((line, index) => ({ ...line, id: `resolved_${index}` }));

  return {
    content: generateASS(scriptInfo, styles, mergedLines),
    lineCount: mergedLines.length,
  };
}

async function persistResolvedSubtitleVersion(
  conflict: {
    id: string;
    project_id: string;
    unit_id: string | null;
  },
  resolverId: string,
  content: string,
  lineCount: number,
  mergeJobId?: string,
  outputFileId?: string | null
) {
  const checksum = createHash("sha256").update(content).digest("hex");
  const fileName = `resolved_${conflict.unit_id || conflict.project_id}_${Date.now()}.ass`;
  let storagePath = `generated/resolved/${conflict.project_id}/${fileName}`;
  let storageBackendId: string | null = null;

  const project = await prisma.project.findUnique({
    where: { id: conflict.project_id },
    select: { storage_backend_id: true },
  });

  try {
    const backend = project?.storage_backend_id
      ? await prisma.storageBackend.findUnique({ where: { id: project.storage_backend_id } })
      : await storageService.getDefaultBackend();

    if (backend?.is_active) {
      const uploaded = await storageService.uploadFile(
        backend.id,
        conflict.project_id,
        Buffer.from(content, "utf-8"),
        fileName,
        "application/x-ass"
      );
      storagePath = uploaded.storagePath;
      storageBackendId = backend.id;
    }
  } catch {
    // Keep a deterministic virtual path when storage is not configured in tests or local scans.
  }

  let fileId = outputFileId || null;
  let version;

  if (fileId) {
    const existing = await prisma.fileEntity.findUnique({ where: { id: fileId } });
    if (!existing) {
      fileId = null;
    }
  }

  if (fileId) {
    const latest = await prisma.fileVersion.findFirst({
      where: { file_id: fileId },
      orderBy: { version_number: "desc" },
    });
    const nextVersionNumber = (latest?.version_number || 0) + 1;

    await prisma.fileVersion.updateMany({
      where: { file_id: fileId },
      data: { is_current: false, is_latest: false },
    });

    version = await prisma.fileVersion.create({
      data: {
        file_id: fileId,
        version_number: nextVersionNumber,
        storage_path: storagePath,
        size_bytes: Buffer.byteLength(content, "utf-8"),
        checksum,
        change_summary: `Resolved conflict ${conflict.id}`,
        is_current: true,
        is_latest: true,
        is_latest_approved: false,
      },
    });

    await prisma.fileEntity.update({
      where: { id: fileId },
      data: {
        storage_path: storagePath,
        storage_backend_id: storageBackendId,
        size_bytes: Buffer.byteLength(content, "utf-8"),
        checksum,
        metadata: JSON.stringify({
          merge_job_id: mergeJobId,
          unit_id: conflict.unit_id,
          resolved_conflict_id: conflict.id,
          line_count: lineCount,
        }),
      },
    });
  } else {
    const file = await prisma.fileEntity.create({
      data: {
        project_id: conflict.project_id,
        uploader_id: resolverId,
        name: fileName,
        original_name: fileName,
        file_type: "subtitle",
        mime_type: "application/x-ass",
        size_bytes: Buffer.byteLength(content, "utf-8"),
        storage_path: storagePath,
        storage_backend_id: storageBackendId,
        checksum,
        metadata: JSON.stringify({
          merge_job_id: mergeJobId,
          unit_id: conflict.unit_id,
          resolved_conflict_id: conflict.id,
          line_count: lineCount,
        }),
      },
    });
    fileId = file.id;

    version = await prisma.fileVersion.create({
      data: {
        file_id: file.id,
        version_number: 1,
        storage_path: storagePath,
        size_bytes: Buffer.byteLength(content, "utf-8"),
        checksum,
        change_summary: `Resolved conflict ${conflict.id}`,
        is_current: true,
        is_latest: true,
        is_latest_approved: false,
      },
    });
  }

  let task = await prisma.task.findFirst({
    where: {
      project_id: conflict.project_id,
      unit_id: conflict.unit_id,
      role: "translation",
    },
    orderBy: { created_at: "desc" },
  });

  if (!task) {
    task = await prisma.task.create({
      data: {
        project_id: conflict.project_id,
        unit_id: conflict.unit_id,
        title: `Resolved merged subtitle - ${conflict.unit_id || conflict.project_id}`,
        role: "translation",
        status: "completed",
        creator_id: resolverId,
        completed_at: new Date(),
      },
    });
  }

  await prisma.translationSubmission.create({
    data: {
      task_id: task.id,
      user_id: resolverId,
      file_version_id: version.id,
      content,
      line_count: lineCount,
    },
  });

  return {
    file_id: fileId,
    version_id: version.id,
    version_number: version.version_number,
  };
}

// ==================== CONFLICT RESOLUTION ====================

export async function resolveConflict(
  conflictId: string,
  resolverId: string,
  userRole: string,
  data: ResolveConflictInput
) {
  // Only supervisors and designated reviewers can resolve conflicts
  if (userRole !== "supervisor" && userRole !== "super_admin" && userRole !== "group_admin") {
    throw new AppError(
      "Only supervisors and designated reviewers can resolve conflicts",
      "FORBIDDEN",
      403
    );
  }

  const conflict = await prisma.subtitleConflict.findUnique({
    where: { id: conflictId },
  });

  if (!conflict) {
    throw new AppError("Conflict not found", "NOT_FOUND", 404);
  }

  if (conflict.resolution !== "unresolved") {
    throw new AppError("Conflict is already resolved", "BAD_REQUEST", 400);
  }

  const resolution =
    data.resolution ??
    (data.status === "deferred" ? "ignored" : "resolved_manual");
  const resolutionNote =
    data.resolution_note ??
    data.mergedText ??
    (data.keepTranslationId ? `keepTranslationId:${data.keepTranslationId}` : null);

  const latestJob = await prisma.mergeJob.findFirst({
    where: {
      project_id: conflict.project_id,
      unit_id: conflict.unit_id,
    },
    orderBy: { created_at: "desc" },
  });

  let resolvedOutput: Awaited<ReturnType<typeof persistResolvedSubtitleVersion>> | null = null;
  if (resolution !== "ignored") {
    const keepFileId = data.keepTranslationId ??
      (resolutionNote?.startsWith("keepTranslationId:")
        ? resolutionNote.slice("keepTranslationId:".length)
        : undefined);
    const [sourceA, sourceB] = await Promise.all([
      getCurrentSubtitleContent(conflict.file_a_id),
      getCurrentSubtitleContent(conflict.file_b_id),
    ]);
    const resolvedSubtitle = buildResolvedSubtitleContent(
      conflict,
      sourceA,
      sourceB,
      resolutionNote,
      keepFileId
    );

    resolvedOutput = await persistResolvedSubtitleVersion(
      conflict,
      resolverId,
      resolvedSubtitle.content,
      resolvedSubtitle.lineCount,
      latestJob?.id,
      latestJob?.output_file_id
    );
  }

  const updated = await prisma.subtitleConflict.update({
    where: { id: conflictId },
    data: {
      resolution,
      resolved_by: resolverId,
      resolved_at: new Date(),
      resolution_note: resolutionNote,
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      user_id: resolverId,
      project_id: conflict.project_id,
      action: "conflict.resolve",
      resource_type: "subtitle_conflict",
      resource_id: conflictId,
      old_value: JSON.stringify({ resolution: "unresolved" }),
      new_value: JSON.stringify({
        resolution,
        note: resolutionNote,
        resolved_output: resolvedOutput,
      }),
    },
  });

  if (latestJob && resolvedOutput) {
    const logData = safeJsonParse<Record<string, unknown>>(latestJob.log, {});
    await prisma.mergeJob.update({
      where: { id: latestJob.id },
      data: {
        status: "completed",
        output_file_id: resolvedOutput.file_id,
        log: JSON.stringify({
          ...logData,
          resolved_output_file_id: resolvedOutput.file_id,
          resolved_output_version_id: resolvedOutput.version_id,
          resolved_conflict_id: conflict.id,
          resolved_at: new Date().toISOString(),
        }),
      },
    });
  }

  // Check if all conflicts for this unit are resolved, then regenerate merged version
  const unresolvedCount = await prisma.subtitleConflict.count({
    where: {
      project_id: conflict.project_id,
      unit_id: conflict.unit_id,
      resolution: "unresolved",
    },
  });

  if (unresolvedCount === 0) {
    if (latestJob) {
      const refreshedJob = await prisma.mergeJob.findUnique({ where: { id: latestJob.id } });
      const logData = safeJsonParse<Record<string, unknown>>(refreshedJob?.log, {});
      await prisma.mergeJob.update({
        where: { id: latestJob.id },
        data: {
          log: JSON.stringify({
            ...logData,
            needs_regeneration: false,
            all_conflicts_resolved_at: new Date().toISOString(),
          }),
        },
      });
    }
  }

  return {
    ...updated,
    resolved_output: resolvedOutput,
  };
}

export async function getConflictDetail(conflictId: string) {
  const conflict = await prisma.subtitleConflict.findUnique({
    where: { id: conflictId },
  });

  if (!conflict) {
    throw new AppError("Conflict not found", "NOT_FOUND", 404);
  }

  // Get file details for both sides
  const fileA = await prisma.fileEntity.findUnique({
    where: { id: conflict.file_a_id },
    select: {
      id: true,
      name: true,
      uploader: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  const fileB = await prisma.fileEntity.findUnique({
    where: { id: conflict.file_b_id },
    select: {
      id: true,
      name: true,
      uploader: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  // Get resolver info if resolved
  let resolver = null;
  if (conflict.resolved_by) {
    resolver = await prisma.user.findUnique({
      where: { id: conflict.resolved_by },
      select: {
        id: true,
        username: true,
        nickname: true,
      },
    });
  }

  return {
    ...conflict,
    file_a: fileA,
    file_b: fileB,
    resolver,
  };
}

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
      conflict_type: data.conflict_type as ConflictType,
      description: data.description,
      affected_lines: data.affected_lines,
      file_a_id: data.file_a_id,
      file_b_id: data.file_b_id,
    },
  });

  return conflict;
}

// ==================== VERSION COMPARISON ====================

export interface LineDiff {
  type: "added" | "removed" | "modified" | "unchanged";
  line: ASSLine;
  oldLine?: ASSLine;
  newLine?: ASSLine;
}

export interface VersionComparison {
  file_a: { id: string; name: string };
  file_b: { id: string; name: string };
  added: ASSLine[];
  removed: ASSLine[];
  modified: Array<{ old: ASSLine; new: ASSLine }>;
  unchanged: ASSLine[];
}

export async function compareVersions(
  fileVersionId1: string,
  fileVersionId2: string
): Promise<VersionComparison> {
  const [version1, version2] = await Promise.all([
    prisma.fileVersion.findUnique({
      where: { id: fileVersionId1 },
      include: { file: true },
    }),
    prisma.fileVersion.findUnique({
      where: { id: fileVersionId2 },
      include: { file: true },
    }),
  ]);

  if (!version1 || !version2) {
    throw new AppError("One or both file versions not found", "NOT_FOUND", 404);
  }

  // Get content from submissions
  const [sub1, sub2] = await Promise.all([
    prisma.translationSubmission.findFirst({
      where: { file_version_id: fileVersionId1 },
    }),
    prisma.translationSubmission.findFirst({
      where: { file_version_id: fileVersionId2 },
    }),
  ]);

  if (!sub1?.content || !sub2?.content) {
    throw new AppError(
      "Cannot compare versions without ASS content",
      "BAD_REQUEST",
      400
    );
  }

  const parsed1 = parseASS(sub1.content);
  const parsed2 = parseASS(sub2.content);

  const lines1 = parsed1.lines;
  const lines2 = parsed2.lines;

  const added: ASSLine[] = [];
  const removed: ASSLine[] = [];
  const modified: Array<{ old: ASSLine; new: ASSLine }> = [];
  const unchanged: ASSLine[] = [];

  // Index lines by (startTime, endTime) for matching
  const map1 = new Map<string, ASSLine>();
  const map2 = new Map<string, ASSLine>();

  for (const line of lines1) {
    const key = `${line.startTime.toFixed(2)}_${line.endTime.toFixed(2)}`;
    map1.set(key, line);
  }

  for (const line of lines2) {
    const key = `${line.startTime.toFixed(2)}_${line.endTime.toFixed(2)}`;
    map2.set(key, line);
  }

  // Find added and modified
  for (const [key, line2] of map2.entries()) {
    const line1 = map1.get(key);
    if (!line1) {
      added.push(line2);
    } else if (line1.text === line2.text) {
      unchanged.push(line2);
    }
  }

  // Find removed
  for (const [key, line1] of map1.entries()) {
    const line2 = map2.get(key);
    if (!line2 || line1.text !== line2.text) {
      removed.push(line1);
    }
  }

  return {
    file_a: {
      id: version1.file.id,
      name: version1.file.name,
    },
    file_b: {
      id: version2.file.id,
      name: version2.file.name,
    },
    added,
    removed,
    modified,
    unchanged,
  };
}

export interface TimelineSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  style: string;
  hasOverlap: boolean;
  overlappingWith: string[];
}

export interface TimelineVisualization {
  totalDuration: number;
  segments: TimelineSegment[];
  overlapRegions: Array<{ start: number; end: number }>;
}

export async function getTimelineVisualization(
  fileVersionId: string
): Promise<TimelineVisualization> {
  const version = await prisma.fileVersion.findUnique({
    where: { id: fileVersionId },
    include: { file: true },
  });

  if (!version) {
    throw new AppError("File version not found", "NOT_FOUND", 404);
  }

  const submission = await prisma.translationSubmission.findFirst({
    where: { file_version_id: fileVersionId },
  });

  if (!submission?.content) {
    throw new AppError(
      "Cannot generate timeline without ASS content",
      "BAD_REQUEST",
      400
    );
  }

  const parsed = parseASS(submission.content);
  const lines = parsed.lines;

  // Find max end time for total duration
  const totalDuration =
    lines.length > 0 ? Math.max(...lines.map((l) => l.endTime)) : 0;

  const segments: TimelineSegment[] = [];
  const overlapRegions: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const overlappingWith: string[] = [];
    let hasOverlap = false;

    for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      const other = lines[j];
      if (
        line.startTime < other.endTime &&
        other.startTime < line.endTime
      ) {
        hasOverlap = true;
        overlappingWith.push(other.id);
      }
    }

    segments.push({
      id: line.id,
      startTime: line.startTime,
      endTime: line.endTime,
      text: line.text,
      style: line.style,
      hasOverlap,
      overlappingWith,
    });
  }

  // Compute overlap regions (merged intervals where >1 line overlaps)
  const sortedByStart = [...lines].sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < sortedByStart.length; i++) {
    for (let j = i + 1; j < sortedByStart.length; j++) {
      const a = sortedByStart[i];
      const b = sortedByStart[j];
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        const overlapStart = Math.max(a.startTime, b.startTime);
        const overlapEnd = Math.min(a.endTime, b.endTime);

        // Check if this region is already recorded
        const exists = overlapRegions.some(
          (r) =>
            Math.abs(r.start - overlapStart) < 0.01 &&
            Math.abs(r.end - overlapEnd) < 0.01
        );
        if (!exists) {
          overlapRegions.push({ start: overlapStart, end: overlapEnd });
        }
      }
    }
  }

  return {
    totalDuration,
    segments,
    overlapRegions,
  };
}

// ==================== REVIEWS ====================

export async function createReview(reviewerId: string, data: ReviewInput) {
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
        ? "review_approved"
        : data.status === "rejected"
        ? "review_rejected"
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

export async function updateReview(reviewId: string, data: Partial<ReviewInput>) {
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
        ? "review_approved"
        : data.status === "rejected"
        ? "review_rejected"
        : "in_progress";

    await prisma.task.update({
      where: { id: review.task_id },
      data: { status: taskStatus },
    });
  }

  return review;
}

// ==================== SNAPSHOTS ====================

export async function createSnapshot(data: CreateSnapshotInput) {
  const snapshot = await prisma.reviewSnapshot.create({
    data: {
      review_id: data.file_id,
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
