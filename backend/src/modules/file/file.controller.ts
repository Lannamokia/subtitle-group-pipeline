import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as fileService from "./file.service";

export async function createFile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.createFile(req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getFiles(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getFiles(req.query as unknown as Parameters<typeof fileService.getFiles>[0]);
    successResponse(res, result.files, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getFileById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function createVersion(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.createVersion(req.params.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function setCurrentVersion(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.setCurrentVersion(req.params.id, req.params.versionId);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function createLink(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.createLink(req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function deleteFile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.softDeleteFile(req.params.id, req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getUploadPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getUploadPolicy(req.query.project_id as string | undefined);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateUploadPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.updateUploadPolicy(req.body, req.query.project_id as string | undefined);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
