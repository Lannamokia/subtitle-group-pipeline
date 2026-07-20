import { Request, Response, NextFunction } from "express";
import { verifyToken, JWTPayload } from "../utils/jwt";
import { prisma } from "../config/database";
import { errorResponse } from "../utils/response";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    sessionType: "normal" | "recovery";
    jti: string;
    expiresAt?: Date;
  };
}

function recoverySessionMayAccess(req: Request): boolean {
  const path = req.originalUrl.split("?")[0];
  if (req.method === "POST" && path.endsWith("/auth/logout")) return true;
  if (req.method === "GET" && path.endsWith("/auth/me")) return true;
  if (path.includes("/system/captcha/providers")) {
    if (req.method === "GET") return true;
    return req.method === "POST" && (/\/test$/.test(path) || /\/activate$/.test(path));
  }
  if (path.endsWith("/system/captcha/policy")) {
    return req.method === "GET" || req.method === "PUT";
  }
  return false;
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      errorResponse(res, "Authentication required", "UNAUTHORIZED", 401);
      return;
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload.jti) {
      errorResponse(res, "Authentication failed", "UNAUTHORIZED", 401);
      return;
    }

    const revokedToken = await prisma.revokedToken.findUnique({
      where: { jti: payload.jti },
      select: { jti: true },
    });

    if (revokedToken) {
      errorResponse(res, "Authentication failed", "UNAUTHORIZED", 401);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      errorResponse(res, "User not found", "UNAUTHORIZED", 401);
      return;
    }

    if (user.status === "disabled" || user.status === "pending_verification") {
      errorResponse(res, "Account is disabled or pending verification", "FORBIDDEN", 403);
      return;
    }

    const sessionType = payload.sessionType === "recovery" ? "recovery" : "normal";
    if (sessionType === "recovery" && !recoverySessionMayAccess(req)) {
      errorResponse(res, "Recovery session is restricted", "RECOVERY_SESSION_RESTRICTED", 403);
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      sessionType,
      jti: payload.jti,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined,
    };

    next();
  } catch (error) {
    if (error instanceof Error && error.name === "TokenExpiredError") {
      errorResponse(res, "Token expired", "TOKEN_EXPIRED", 401);
      return;
    }
    if (error instanceof Error && error.name === "JsonWebTokenError") {
      errorResponse(res, "Invalid token", "INVALID_TOKEN", 401);
      return;
    }
    errorResponse(res, "Authentication failed", "UNAUTHORIZED", 401);
  }
}

export function requireFullSession(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.sessionType === "recovery") {
    errorResponse(res, "Recovery session is restricted", "RECOVERY_SESSION_RESTRICTED", 403);
    return;
  }
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      errorResponse(res, "Authentication required", "UNAUTHORIZED", 401);
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      errorResponse(res, "Insufficient permissions", "FORBIDDEN", 403);
      return;
    }

    next();
  };
}
