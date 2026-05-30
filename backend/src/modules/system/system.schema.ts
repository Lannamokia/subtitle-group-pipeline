import { z } from "zod";

export const updateBrandingSchema = z.object({
  app_name: z.string().trim().min(1, "App name is required").max(80, "App name is too long"),
});

export const smtpSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().trim().min(1, "SMTP host is required").max(255),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().optional(),
  username: z.string().trim().max(255).optional().nullable(),
  password: z.string().max(1000).optional().nullable(),
  from_address: z.string().trim().email("Invalid sender email address").max(255),
  from_name: z.string().trim().max(120).optional().nullable(),
  reject_unauthorized: z.boolean().optional(),
});

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
export type SmtpSettingsInput = z.infer<typeof smtpSettingsSchema>;
