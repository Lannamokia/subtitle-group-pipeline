import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as taskService from "./task.service";
import * as wikiService from "../wiki/wiki.service";
import type { CreateCommentInput } from "../wiki/wiki.schema";

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

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
    const result = await taskService.getTaskById(getParam(req, "id"));
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
    const result = await taskService.updateTask(getParam(req, "id"), req.body, req.user?.id);
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
    const result = await taskService.deleteTask(getParam(req, "id"), req.user?.id);
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
    const result = await taskService.claimTask(getParam(req, "id"), req.user!.id, req.user?.id);
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
    const { assignee_id, override_reason } = req.body;
    const result = await taskService.assignTask(
      getParam(req, "id"),
      assignee_id,
      req.user?.id,
      override_reason
    );
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
    const result = await taskService.returnTask(getParam(req, "id"), req.user!.id, req.user?.id);
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
    const result = await taskService.startTask(getParam(req, "id"), req.user!.id, req.user?.id);
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
    const result = await taskService.submitTask(getParam(req, "id"), req.user!.id, req.user?.id);
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
    const result = await taskService.cancelTask(getParam(req, "id"), req.user?.id);
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
      getParam(req, "id"),
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
      getParam(req, "id"),
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
    const result = await taskService.resetTask(getParam(req, "id"), req.user?.id, req.body);
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
    const result = await taskService.updateTaskDeadline(getParam(req, "id"), req.body, req.user?.id);
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
      getParam(req, "id"),
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
      getParam(req, "claimId"),
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
      getParam(req, "id"),
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
    const result = await taskService.createDependency(getParam(req, "id"), req.body);
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
      getParam(req, "id"),
      getParam(req, "dependencyId")
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
    const result = await taskService.getProjectWorkload(getParam(req, "projectId"));
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

// ==================== TASK COMMENTS ====================

export async function getTaskComments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.getTaskComments(getParam(req, "id"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function createTaskComment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.createComment(req.user!.id, {
      ...req.body,
      task_id: getParam(req, "id"),
    } as CreateCommentInput);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}
