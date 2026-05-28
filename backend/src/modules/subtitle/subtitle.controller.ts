import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as subtitleService from "./subtitle.service";

// Merge Jobs
export async function createMergeJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.createMergeJob(req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

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

export async function getMergeJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getMergeJobById(req.params.id);
    successResponse(res, result);
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

// Conflicts
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

export async function resolveConflict(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.resolveConflict(req.params.id, req.user!.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// Reviews
export async function createReview(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.createReview(req.user!.id, req.body);
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
