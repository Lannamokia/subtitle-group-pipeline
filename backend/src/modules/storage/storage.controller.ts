import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as storageService from "./storage.service";

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

export async function createBackend(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.createStorageBackend(req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getBackends(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.getStorageBackends(
      req.query as unknown as Parameters<typeof storageService.getStorageBackends>[0]
    );
    successResponse(res, result.backends, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getBackend(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.getBackendById(getParam(req, "id"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getDefaultBackend(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.getDefaultBackend();
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateBackend(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.updateStorageBackend(getParam(req, "id"), req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteBackend(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.deleteStorageBackend(getParam(req, "id"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function uploadAvatar(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files;
    const uploadedFile =
      req.file ||
      (Array.isArray(files) ? files[0] : files ? Object.values(files)[0]?.[0] : undefined);

    if (!uploadedFile) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "No file uploaded" },
      });
      return;
    }

    const result = await storageService.uploadAvatar(
      req.user!.id,
      uploadedFile.buffer,
      uploadedFile.mimetype,
      uploadedFile.originalname
    );

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getStorageStats(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.getStorageStats();
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getDataRetentionSettings(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.getDataRetentionSettings();
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateDataRetentionSettings(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.updateDataRetentionSettings(_req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
