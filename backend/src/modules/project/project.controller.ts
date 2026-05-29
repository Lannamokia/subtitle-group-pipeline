import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as projectService from "./project.service";
import * as subtitleService from "../subtitle/subtitle.service";
import type { ResolveConflictInput } from "../subtitle/subtitle.schema";

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

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
    const result = await projectService.getProjectById(getParam(req, "id"));
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
    const result = await projectService.updateProject(getParam(req, "id"), req.body, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getProjectConflicts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.getConflicts({
      ...(req.query as Record<string, unknown>),
      project_id: getParam(req, "id"),
    } as Parameters<typeof subtitleService.getConflicts>[0]);
    successResponse(res, result.conflicts, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function resolveProjectConflict(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await subtitleService.resolveConflict(
      getParam(req, "conflictId"),
      req.user!.id,
      req.user!.role,
      req.body as ResolveConflictInput
    );
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
    const result = await projectService.archiveProject(getParam(req, "id"), req.user?.id);
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
    const result = await projectService.unarchiveProject(getParam(req, "id"), req.user?.id);
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
    const result = await projectService.softDeleteProject(getParam(req, "id"), req.user?.id);
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
    const result = await projectService.restoreProject(getParam(req, "id"), req.user?.id);
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
    const result = await projectService.getProjectMembers(getParam(req, "id"));
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
    const result = await projectService.addMember(getParam(req, "id"), req.body, req.user?.id);
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
    const result = await projectService.removeMember(getParam(req, "id"), getParam(req, "userId"), req.user?.id);
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
    const result = await projectService.updateMember(getParam(req, "id"), getParam(req, "userId"), req.body);
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
    const result = await projectService.createUnit(getParam(req, "id"), req.body, req.user?.id);
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
    const result = await projectService.createJoinRequest(getParam(req, "id"), req.user!.id, req.body);
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
      getParam(req, "requestId"),
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
    const result = await projectService.getJoinRequests(getParam(req, "id"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
