import { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../middleware/auth";
import { getClientIp } from "../../utils/clientIp";
import { AppError, successResponse } from "../../utils/response";
import * as service from "./captcha.service";

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export async function publicConfig(_req: Request, res: Response, next: NextFunction) {
  try { successResponse(res, await service.getPublicConfig()); } catch (error) { next(error); }
}

export async function createAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const origin = req.headers.origin || env.CORS_ORIGIN;
    successResponse(res, await service.createAttempt({
      username: req.body.username,
      ip: getClientIp(req),
      parentOrigin: origin,
      theme: req.body.theme,
      brandColor: req.body.brandColor,
    }), 201);
  } catch (error) { next(error); }
}

export async function completeAttempt(req: Request, res: Response, next: NextFunction) {
  try { successResponse(res, await service.completeAttempt(routeParam(req.params.id), req.body.providerToken)); }
  catch (error) { next(error); }
}

export async function outageTicket(req: Request, res: Response, next: NextFunction) {
  try { successResponse(res, await service.issueOutageTicket(req.body.username, getClientIp(req)), 201); }
  catch (error) { next(error); }
}

export async function recoveryLogin(req: Request, res: Response, next: NextFunction) {
  try {
    successResponse(res, await service.recoveryLogin({
      ...req.body,
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"],
    }));
  } catch (error) { next(error); }
}

export async function listProfiles(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try { successResponse(res, await service.listProfiles()); } catch (error) { next(error); }
}

export async function createProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try { successResponse(res, await service.createProfile(req.body, req.user!.id), 201); }
  catch (error) { next(error); }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try { successResponse(res, await service.updateProfile(routeParam(req.params.id), req.body, req.user!.id)); }
  catch (error) { next(error); }
}

export async function testProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try { successResponse(res, await service.testProfile(routeParam(req.params.id))); } catch (error) { next(error); }
}

async function terminateRecoverySession(req: AuthenticatedRequest) {
  if (req.user?.sessionType !== "recovery") return;
  await prisma.revokedToken.upsert({
    where: { jti: req.user.jti },
    update: { expires_at: req.user.expiresAt || new Date(Date.now() + 10 * 60 * 1000) },
    create: {
      jti: req.user.jti,
      user_id: req.user.id,
      expires_at: req.user.expiresAt || new Date(Date.now() + 10 * 60 * 1000),
    },
  });
}

export async function activateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await service.activateProfile(routeParam(req.params.id), req.user!.id);
    await terminateRecoverySession(req);
    successResponse(res, { ...result, recoverySessionTerminated: req.user!.sessionType === "recovery" });
  } catch (error) { next(error); }
}

export async function rotateRecoveryKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try { successResponse(res, await service.rotateRecoveryKey(routeParam(req.params.id), req.user!.id)); }
  catch (error) { next(error); }
}

export async function getPolicy(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const policy = await service.getPolicy();
    successResponse(res, {
      enabled: policy.enabled,
      level: policy.level,
      activeProviderId: policy.active_provider_id,
      configVersion: policy.config_version,
    });
  } catch (error) { next(error); }
}

export async function updatePolicy(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.sessionType === "recovery" && (req.body.enabled !== false || req.body.level !== undefined)) {
      throw new AppError("Recovery session may only disable captcha", "RECOVERY_SESSION_RESTRICTED", 403);
    }
    const result = await service.updatePolicy(req.body, req.user!.id);
    if (req.user!.sessionType === "recovery") await terminateRecoverySession(req);
    successResponse(res, { ...result, recoverySessionTerminated: req.user!.sessionType === "recovery" });
  } catch (error) { next(error); }
}
