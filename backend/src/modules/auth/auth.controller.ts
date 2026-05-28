import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { authenticate, AuthenticatedRequest } from "../../middleware/auth";
import * as authService from "./auth.service";

export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.registerUser(req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.loginUser(req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function me(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await authService.getCurrentUser(req.user!.id);
    successResponse(res, user);
  } catch (error) {
    next(error);
  }
}

export async function changePassword(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.changePassword(req.user!.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.updateProfile(req.user!.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
