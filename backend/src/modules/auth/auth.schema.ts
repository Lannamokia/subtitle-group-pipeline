import { z } from "zod";

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_\-]+$/,
      "Username can only contain letters, numbers, underscores, and hyphens"
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  nickname: z.string().max(50).optional(),
  email: z.string().email("Invalid email address").optional().nullable(),
  qq_number: z.string().max(20).optional().nullable(),
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters")
    .max(128, "New password must be at most 128 characters"),
});

export const updateProfileSchema = z.object({
  nickname: z.string().max(50).optional(),
  email: z.string().email("Invalid email address").optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  avatar_url: z.string().url("Invalid URL").optional().nullable(),
});

export const verifyQQSchema = z.object({
  code: z.string().min(1, "Verification code is required"),
  qq_number: z.string().optional(),
  qq_group: z.string().optional(),
});

export const requestPasswordResetSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

export const createRoleTagSchema = z.object({
  name: z.string().min(1, "Tag name is required").max(50),
  description: z.string().max(500).optional(),
  color: z.string().max(50).optional(),
});

export const updateRoleTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().max(50).optional(),
});

export const createTagApplicationSchema = z.object({
  tag_id: z.string().uuid("Invalid tag ID"),
  reason: z.string().max(500).optional(),
});

export const reviewTagApplicationSchema = z.object({
  application_id: z.string().uuid("Invalid application ID"),
  approved: z.boolean(),
  rejection_reason: z.string().max(500).optional(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["super_admin", "group_admin", "supervisor", "member"]),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(["active", "disabled", "pending_verification"]),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type VerifyQQInput = z.infer<typeof verifyQQSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type CreateRoleTagInput = z.infer<typeof createRoleTagSchema>;
export type UpdateRoleTagInput = z.infer<typeof updateRoleTagSchema>;
export type CreateTagApplicationInput = z.infer<typeof createTagApplicationSchema>;
export type ReviewTagApplicationInput = z.infer<typeof reviewTagApplicationSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
