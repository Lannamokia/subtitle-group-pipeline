import { z } from "zod";

const taskRoleSchema = z.enum([
  "source",
  "timing",
  "translation",
  "post_production",
  "encoding",
  "release",
  "supervisor",
]);

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
  qq: z.string().max(20).optional().nullable(),
  tags: z.array(z.string().uuid("Invalid tag ID")).optional().default([]),
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

export const updateRegistrationPolicySchema = z.object({
  mode: z.enum(["disabled", "open", "qq_verification"]),
  require_qq: z.boolean().optional(),
  qq_group_number: z.string().max(50).optional().nullable(),
  qqGroup: z.string().max(50).optional().nullable(),
  welcome_message: z.string().max(1000).optional().nullable(),
  auto_approve: z.boolean().optional(),
  codeLength: z.number().int().optional(),
  roleTagEnabled: z.boolean().optional(),
});

export const requestPasswordResetSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

export const confirmPasswordResetSchema = z.object({
  username: z.string().min(1, "Username is required"),
  code: z.string().min(1, "Reset code is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const createRoleTagSchema = z.object({
  name: z.string().min(1, "Tag name is required").max(50),
  roleType: z.enum(["source", "timing", "translation", "post_production", "encoding", "release", "supervisor"]).optional(),
  role_type: z.enum(["source", "timing", "translation", "post_production", "encoding", "release", "supervisor"]).optional(),
  description: z.string().max(500).optional(),
  color: z.string().max(50).optional(),
});

export const updateRoleTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  roleType: z.enum(["source", "timing", "translation", "post_production", "encoding", "release", "supervisor"]).optional(),
  role_type: z.enum(["source", "timing", "translation", "post_production", "encoding", "release", "supervisor"]).optional(),
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

export const resetTagStatusSchema = z.object({
  tagIds: z.array(z.string().uuid("Invalid tag ID")).min(1, "At least one tag ID is required"),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["super_admin", "group_admin", "supervisor", "member"]),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(["active", "disabled", "pending_verification"]),
});

export const createMemberSchema = z.object({
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
  nickname: z.string().max(50).optional().nullable(),
  email: z.string().email("Invalid email address").optional().nullable(),
  qq_number: z.string().max(20).optional().nullable(),
  qq: z.string().max(20).optional().nullable(),
  role: z.enum(["super_admin", "group_admin", "supervisor", "member"]).default("member"),
  status: z.enum(["active", "disabled"]).default("active"),
  tagIds: z.array(z.string().uuid("Invalid tag ID")).optional().default([]),
});

export const resetUserPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type VerifyQQInput = z.infer<typeof verifyQQSchema>;
export type UpdateRegistrationPolicyInput = z.infer<typeof updateRegistrationPolicySchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;
export type CreateRoleTagInput = z.infer<typeof createRoleTagSchema>;
export type UpdateRoleTagInput = z.infer<typeof updateRoleTagSchema>;
export type CreateTagApplicationInput = z.infer<typeof createTagApplicationSchema>;
export type ReviewTagApplicationInput = z.infer<typeof reviewTagApplicationSchema>;
export type ResetTagStatusInput = z.infer<typeof resetTagStatusSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
