import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as controller from "./auth.controller";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  updateProfileSchema,
  verifyQQSchema,
  updateRegistrationPolicySchema,
  requestPasswordResetSchema,
  createRoleTagSchema,
  updateRoleTagSchema,
  createTagApplicationSchema,
  reviewTagApplicationSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  createMemberSchema,
  resetUserPasswordSchema,
} from "./auth.schema";

const router = Router();

const limiterStores: Array<Map<string, { count: number; resetTime: number }>> = [];

export function resetAuthRateLimiters() {
  for (const attempts of limiterStores) {
    attempts.clear();
  }
}

// In-memory rate limiter for auth endpoints (fallback when express-rate-limit not installed)
const authRateLimiter = (windowMs: number, maxRequests: number) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();
  limiterStores.push(attempts);

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
router.get("/registration-policy", controller.getRegistrationPolicy);
router.put(
  "/registration-policy",
  authenticate,
  requireRole("super_admin", "group_admin"),
  validateBody(updateRegistrationPolicySchema),
  controller.updateRegistrationPolicy
);

// Role tags
router.get("/role-tags", controller.getRoleTags);
router.post("/role-tags", authenticate, requireRole("super_admin", "group_admin"), validateBody(createRoleTagSchema), controller.createRoleTag);
router.put("/role-tags/:id", authenticate, requireRole("super_admin", "group_admin"), validateBody(updateRoleTagSchema), controller.updateRoleTag);
router.delete("/role-tags/:id", authenticate, requireRole("super_admin", "group_admin"), controller.deleteRoleTag);
router.get("/role-tags/my-status", authenticate, controller.getMyRoleTagStatuses);
router.post("/tag-applications", authenticate, validateBody(createTagApplicationSchema), controller.createTagApplication);
router.get("/tag-applications/my", authenticate, controller.getMyTagApplications);
router.get("/tag-applications/pending", authenticate, requireRole("super_admin", "group_admin"), controller.getPendingTagApplications);
router.post("/tag-applications/review", authenticate, requireRole("super_admin", "group_admin"), validateBody(reviewTagApplicationSchema), controller.reviewTagApplication);

// Member management routes (compatibility for /members and /users)
router.get("/members", authenticate, controller.getAllUsers);
router.get("/users", authenticate, controller.getAllUsers);
router.post("/members", authenticate, requireRole("super_admin", "group_admin", "supervisor"), validateBody(createMemberSchema), controller.createMember);
router.put("/members/:id/role", authenticate, requireRole("super_admin", "group_admin"), validateBody(updateUserRoleSchema), controller.updateUserRole);
router.put("/members/:id/status", authenticate, requireRole("super_admin", "group_admin"), validateBody(updateUserStatusSchema), controller.updateUserStatus);
router.put("/members/:id/password", authenticate, requireRole("super_admin", "group_admin"), validateBody(resetUserPasswordSchema), controller.resetUserPassword);
router.delete("/members/:id", authenticate, requireRole("super_admin", "group_admin"), controller.deleteMember);

export default router;
