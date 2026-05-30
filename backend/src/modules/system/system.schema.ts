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

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
export type SmtpSettingsInput = z.infer<typeof smtpSettingsSchema>;
export type QqBridgeSettingsInput = z.infer<typeof qqBridgeSettingsSchema>;
