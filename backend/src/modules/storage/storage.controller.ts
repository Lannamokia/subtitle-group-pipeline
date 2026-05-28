import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import * as storageService from "./storage.service";

export async function createBackend(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await storageService.createBackend(req.body);
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
    const result = await storageService.getBackends(req.query as unknown as Parameters<typeof storageService.getBackends>[0]);
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
    const result = await storageService.getBackendById(req.params.id);
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
    const result = await storageService.updateBackend(req.params.id, req.body);
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
    const result = await storageService.deleteBackend(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
