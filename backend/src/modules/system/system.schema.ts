import { z } from "zod";

export const updateBrandingSchema = z.object({
  app_name: z.string().trim().min(1, "App name is required").max(80, "App name is too long"),
});

export const smtpSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().trim().max(255).optional().nullable(),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().optional(),
  username: z.string().trim().max(255).optional().nullable(),
  password: z.string().max(1000).optional().nullable(),
  from_address: z.string().trim().max(255).optional().nullable().refine(
    (value) => !value || z.string().email().safeParse(value).success,
    "Invalid sender email address"
  ),
  from_name: z.string().trim().max(120).optional().nullable(),
  reject_unauthorized: z.boolean().optional(),
});

export const qqBridgeSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  endpoint: z.string().trim().url("Invalid NoneBot endpoint").max(500).optional().nullable(),
  secret: z.string().max(1000).optional().nullable(),
});

export const smtpTestSchema = z.object({
  to: z.string().trim().email("Invalid test email address").max(255),
});

export const qqBridgeTestSchema = z.object({
  group_id: z.string().trim().min(1, "QQ group is required").max(50).optional(),
  groupId: z.string().trim().min(1, "QQ group is required").max(50).optional(),
  at_user_qq: z.string().trim().min(1, "Target QQ is required").max(50).optional(),
  atUserQQ: z.string().trim().min(1, "Target QQ is required").max(50).optional(),
}).refine((data) => Boolean(data.group_id ?? data.groupId), "QQ group is required")
  .refine((data) => Boolean(data.at_user_qq ?? data.atUserQQ), "Target QQ is required");

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
export type SmtpSettingsInput = z.infer<typeof smtpSettingsSchema>;
export type QqBridgeSettingsInput = z.infer<typeof qqBridgeSettingsSchema>;
export type SmtpTestInput = z.infer<typeof smtpTestSchema>;
export type QqBridgeTestInput = z.infer<typeof qqBridgeTestSchema>;
