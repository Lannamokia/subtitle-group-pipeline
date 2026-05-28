import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as subtitleService from "./subtitle.service";
import type {
  CreateTranslationClaimInput,
  SubmitTranslationInput,
  CreateUnitMergeJobInput,
  ResolveConflictInput,
  ReviewInput,
} from "./subtitle.schema";

// ==================== TRANSLATION CLAIMS ====================

export async function createTranslationClaim(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { projectId, unitId } = req.params;
    const userId = req.user!.id;
    const data = req.body as CreateTranslationClaimInput;

    const result = await subtitleService.createTranslationClaim(unitId, userId, data);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function releaseTranslationClaim(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { claimId } = req.params;
    const userId = req.user!.id;

    const result = await subtitleService.releaseTranslationClaim(claimId, userId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getTranslationClaims(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { unitId } = req.params;

    const result = await subtitleService.getTranslationClaims(unitId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getTranslationClaimById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { claimId } = req.params;

    const result = await subtitleService.getTranslationClaimById(claimId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== TRANSLATION SUBMISSIONS ====================

export async function submitTranslation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { taskId } = req.params;
    const userId = req.user!.id;
    const data = req.body as SubmitTranslationInput;

    const result = await subtitleService.submitTranslation(taskId, userId, data);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getSubmissionsByTask(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { taskId } = req.params;

    const result = await subtitleService.getSubmissionsByTask(taskId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== MERGE JOBS ====================

export async function createMergeJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { unitId } = req.params;
    const userId = req.user!.id;
    const data = req.body as CreateUnitMergeJobInput;

    const result = await subtitleService.createMergeJob(unitId, data.claim_ids, userId);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getMergeJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { jobId } = req.params;

    const result = await subtitleService.getMergeJobStatus(jobId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getMergeConflicts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { jobId } = req.params;

    const result = await subtitleService.getMergeConflicts(jobId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// Legacy merge job endpoints
export async function getMergeJobs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getMergeJobs(req.query as unknown as Parameters<typeof subtitleService.getMergeJobs>[0]);
    successResponse(res, result.jobs, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function updateMergeJobStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.updateMergeJobStatus(
      req.params.id,
      req.body.status,
      req.body.output_file_id,
      req.body.log
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== CONFLICTS ====================

export async function getConflicts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getConflicts(req.query as unknown as Parameters<typeof subtitleService.getConflicts>[0]);
    successResponse(res, result.conflicts, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getConflict(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getConflictById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getConflictDetail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getConflictDetail(req.params.conflictId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function resolveConflict(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.resolveConflict(
      req.params.conflictId,
      req.user!.id,
      req.user!.role,
      req.body as ResolveConflictInput
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== VERSION COMPARISON ====================

export async function compareVersions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { fileId, otherFileId } = req.params;

    const result = await subtitleService.compareVersions(fileId, otherFileId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getTimelineVisualization(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { fileId } = req.params;

    const result = await subtitleService.getTimelineVisualization(fileId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== REVIEWS ====================

export async function createReview(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.createReview(req.user!.id, req.body as ReviewInput);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getReviews(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getReviews(req.params.projectId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getReview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getReviewById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateReview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.updateReview(req.params.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
