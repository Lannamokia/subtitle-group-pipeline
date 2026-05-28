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

export async function createProjectFromTemplate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.createProjectFromTemplate(req.user!.id, req.body);
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
    const result = await projectService.getProjects(
      req.query as unknown as Parameters<typeof projectService.getProjects>[0],
      req.user?.id
    );
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
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.updateProject(req.params.id, req.body, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function archiveProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.archiveProject(req.params.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function unarchiveProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.unarchiveProject(req.params.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function softDeleteProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.softDeleteProject(req.params.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function restoreProject(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.restoreProject(req.params.id, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getProjectMembers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.getProjectMembers(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function addMember(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.addMember(req.params.id, req.body, req.user?.id);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function removeMember(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.removeMember(req.params.id, req.params.userId, req.user?.id);
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
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.createUnit(req.params.id, req.body, req.user?.id);
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
      req.body
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getJoinRequests(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await projectService.getJoinRequests(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
