import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import {
  authRateLimiter as rateLimitMiddleware,
  registerRateLimit,
  resetRateLimiters,
} from "../../middleware/rateLimit";
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
  confirmPasswordResetSchema,
  createRoleTagSchema,
  updateRoleTagSchema,
  createTagApplicationSchema,
  reviewTagApplicationSchema,
  resetTagStatusSchema,
  grantTagStatusSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  createMemberSchema,
  resetUserPasswordSchema,
  updateMemberProfileSchema,
  requestQQRebindSchema,
} from "./auth.schema";

const router = Router();

export function resetAuthRateLimiters() {
  resetRateLimiters();
}

// Auth routes
router.post("/register", registerRateLimit, validateBody(registerSchema), controller.register);
router.post("/login", rateLimitMiddleware, validateBody(loginSchema), controller.login);
router.post("/refresh", validateBody(refreshTokenSchema), controller.refresh);
router.post("/logout", authenticate, controller.logout);
router.get("/me", authenticate, controller.me);
router.put("/profile", authenticate, validateBody(updateProfileSchema), controller.updateProfile);
router.post("/qq-rebind/request", authenticate, validateBody(requestQQRebindSchema), controller.requestQQRebind);
router.post("/change-password", authenticate, validateBody(changePasswordSchema), controller.changePassword);
router.post("/verify-qq", validateBody(verifyQQSchema), controller.verifyQQ);
router.post("/request-password-reset", rateLimitMiddleware, validateBody(requestPasswordResetSchema), controller.requestPasswordReset);
router.post("/confirm-password-reset", rateLimitMiddleware, validateBody(confirmPasswordResetSchema), controller.confirmPasswordReset);
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
router.post("/role-tags/my-status/reset", authenticate, validateBody(resetTagStatusSchema), controller.resetMyTagStatuses);

// Member management routes (compatibility for /members and /users)
router.get("/members", authenticate, controller.getAllUsers);
router.get("/users", authenticate, controller.getAllUsers);
router.post("/members", authenticate, requireRole("super_admin", "group_admin", "supervisor"), validateBody(createMemberSchema), controller.createMember);
router.put("/members/:id/profile", authenticate, requireRole("super_admin", "group_admin"), validateBody(updateMemberProfileSchema), controller.updateMemberProfile);
router.put("/members/:id/role", authenticate, requireRole("super_admin", "group_admin"), validateBody(updateUserRoleSchema), controller.updateUserRole);
router.put("/members/:id/status", authenticate, requireRole("super_admin", "group_admin"), validateBody(updateUserStatusSchema), controller.updateUserStatus);
router.post("/members/:id/verify", authenticate, requireRole("super_admin", "group_admin"), controller.approveUserVerification);
router.get("/members/:id/tags/statuses", authenticate, requireRole("super_admin", "group_admin"), controller.getMemberRoleTagStatuses);
router.post("/members/:id/tags/reset", authenticate, requireRole("super_admin", "group_admin"), validateBody(resetTagStatusSchema), controller.resetMemberTagStatuses);
router.post("/members/:id/tags/grant", authenticate, requireRole("super_admin", "group_admin"), validateBody(grantTagStatusSchema), controller.grantMemberTagStatuses);
router.put("/members/:id/password", authenticate, requireRole("super_admin", "group_admin"), validateBody(resetUserPasswordSchema), controller.resetUserPassword);
router.delete("/members/:id", authenticate, requireRole("super_admin", "group_admin"), controller.deleteMember);

export default router;
