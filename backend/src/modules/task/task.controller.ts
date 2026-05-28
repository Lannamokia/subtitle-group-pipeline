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
    const result = await taskService.getTasks(req.query as unknown as Parameters<typeof taskService.getTasks>[0]);
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
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.updateTask(req.params.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteTask(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.deleteTask(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function claimSegment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await taskService.claimSegment(req.params.id, req.user!.id, req.body);
    successResponse(res, result, 201);
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
    const result = await taskService.submitTranslation(req.params.id, req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

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
    const result = await taskService.removeDependency(req.params.id, req.params.dependencyId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
