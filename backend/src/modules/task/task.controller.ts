import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as taskService from "./task.service";

export async function createTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.createTask(req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getTasks(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.getTasks(
      req.query as unknown as Parameters<typeof taskService.getTasks>[0]
    );
    successResponse(res, result.tasks, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getTask(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.getTaskById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.updateTask(req.params.id, req.body, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.deleteTask(req.params.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== STATE TRANSITIONS ====================

export async function claimTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.claimTask(req.params.id, req.user!.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function assignTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { assignee_id } = req.body;
    const result = await taskService.assignTask(req.params.id, assignee_id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function returnTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.returnTask(req.params.id, req.user!.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function startTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.startTask(req.params.id, req.user!.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function submitTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.submitTask(req.params.id, req.user!.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function cancelTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.cancelTask(req.params.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function approveTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.approveTask(
      req.params.id,
      req.user!.id,
      req.body,
      req.user?.id
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function rejectTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.rejectTask(
      req.params.id,
      req.user!.id,
      req.body,
      req.user?.id
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function resetTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.resetTask(req.params.id, req.user?.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateTaskDeadline(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.updateTaskDeadline(req.params.id, req.body, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== TRANSLATION ====================

export async function claimSegment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.claimTranslationSegment(
      req.params.id,
      req.user!.id,
      req.body
    );
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function abandonSegment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.abandonTranslationSegment(
      req.params.claimId,
      req.user!.id
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function submitTranslation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.submitTranslation(
      req.params.id,
      req.user!.id,
      req.body
    );
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

// ==================== DEPENDENCIES ====================

export async function createDependency(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.createDependency(req.params.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function removeDependency(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.removeDependency(
      req.params.id,
      req.params.dependencyId
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// ==================== WORKLOAD DASHBOARD ====================

export async function getPersonalWorkload(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.getPersonalWorkload(req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getProjectWorkload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.getProjectWorkload(req.params.projectId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getGlobalWorkload(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.getGlobalWorkload();
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
