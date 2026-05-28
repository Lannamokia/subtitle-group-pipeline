import { Request, Response, NextFunction } from "express";
import { verifyToken, JWTPayload } from "../utils/jwt";
import { prisma } from "../config/database";
import { errorResponse } from "../utils/response";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
  };
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

    if (user.status === "suspended" || user.status === "inactive") {
      errorResponse(res, "Account is inactive or suspended", "FORBIDDEN", 403);
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
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
