import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as projectService from "./project.service";

export async function createProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.createProject(req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getProjects(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.getProjects(req.query as unknown as Parameters<typeof projectService.getProjects>[0], req.user!.id);
    successResponse(res, result.projects, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getProject(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.getProjectById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateProject(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.updateProject(req.params.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteProject(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.deleteProject(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function archiveProject(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.archiveProject(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function addMember(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.addMember(req.params.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function removeMember(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.removeMember(req.params.id, req.params.userId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateMember(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.updateMember(req.params.id, req.params.userId, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function createUnit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.createUnit(req.params.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function joinRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.createJoinRequest(req.params.id, req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function respondJoinRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.respondToJoinRequest(
      req.params.requestId,
      req.user!.id,
      req.body.approved
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
