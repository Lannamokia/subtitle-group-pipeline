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
    // If requiresVerification, return 200 (not 201) with verification info
    if ("requiresVerification" in result && result.requiresVerification) {
      successResponse(res, result, 200);
      return;
    }
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

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.refreshToken(req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function logout(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.logoutUser(req.user!.id);
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

export async function verifyQQ(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.verifyByQQ(req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function requestPasswordReset(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.requestPasswordReset(req.body.username);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getRoleTags(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.getRoleTags();
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function createRoleTag(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.createRoleTag(req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function updateRoleTag(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.updateRoleTag(String(req.params.id), req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteRoleTag(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await authService.deleteRoleTag(String(req.params.id));
    successResponse(res, { deleted: true });
  } catch (error) {
    next(error);
  }
}

export async function getMyRoleTagStatuses(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.getMyRoleTagStatuses(req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function createTagApplication(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.createTagApplication(req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getMyTagApplications(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.getMyTagApplications(req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getPendingTagApplications(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.getPendingTagApplications();
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function reviewTagApplication(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.reviewTagApplication(req.user!.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
