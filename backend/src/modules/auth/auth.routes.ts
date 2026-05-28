import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as controller from "./auth.controller";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  updateProfileSchema,
  verifyQQSchema,
  requestPasswordResetSchema,
} from "./auth.schema";

const router = Router();

// In-memory rate limiter for auth endpoints (fallback when express-rate-limit not installed)
const authRateLimiter = (windowMs: number, maxRequests: number) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const record = attempts.get(key);

    if (!record || now > record.resetTime) {
      attempts.set(key, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (record.count >= maxRequests) {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests, please try again later.",
        },
      });
      return;
    }

    record.count++;
    next();
  };
};

// Try to use express-rate-limit if available, otherwise fallback
let rateLimitMiddleware: ReturnType<typeof authRateLimiter>;
try {
  const rl = require("express-rate-limit");
  rateLimitMiddleware = rl({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: import("express").Request, res: import("express").Response) => {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests, please try again later.",
        },
      });
    },
  });
} catch {
  rateLimitMiddleware = authRateLimiter(15 * 60 * 1000, 10);
}

// Stricter rate limit for registration
let registerRateLimit: ReturnType<typeof authRateLimiter>;
try {
  const rl = require("express-rate-limit");
  registerRateLimit = rl({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: import("express").Request, res: import("express").Response) => {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many registration attempts, please try again later.",
        },
      });
    },
  });
} catch {
  registerRateLimit = authRateLimiter(60 * 60 * 1000, 5);
}

// Auth routes
router.post("/register", registerRateLimit, validateBody(registerSchema), controller.register);
router.post("/login", rateLimitMiddleware, validateBody(loginSchema), controller.login);
router.post("/refresh", validateBody(refreshTokenSchema), controller.refresh);
router.post("/logout", authenticate, controller.logout);
router.get("/me", authenticate, controller.me);
router.put("/profile", authenticate, validateBody(updateProfileSchema), controller.updateProfile);
router.post("/change-password", authenticate, validateBody(changePasswordSchema), controller.changePassword);
router.post("/verify-qq", validateBody(verifyQQSchema), controller.verifyQQ);
router.post("/request-password-reset", rateLimitMiddleware, validateBody(requestPasswordResetSchema), controller.requestPasswordReset);

export default router;
