import { z } from "zod";

const hostnameSchema = z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/);

const customConfigSchema = z.object({
  baseUrl: z.string().url().refine((value) => value.startsWith("https://") || process.env.NODE_ENV !== "production", {
    message: "Custom captcha service must use HTTPS in production",
  }),
  siteId: z.string().min(1).max(128),
  secret: z.string().min(32).max(512),
});

const turnstileConfigSchema = z.object({
  siteKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(512),
  allowedHostnames: z.array(hostnameSchema).min(1),
  action: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  verifyUrl: z.string().url().optional(),
});

const recaptchaConfigSchema = z.object({
  siteKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(512),
  allowedHostnames: z.array(hostnameSchema).min(1),
  verifyUrl: z.string().url().optional(),
});

export function parseProviderConfig(type: "custom" | "turnstile" | "recaptcha_v2_invisible", value: unknown) {
  if (type === "custom") return customConfigSchema.parse(value);
  if (type === "turnstile") return turnstileConfigSchema.parse(value);
  return recaptchaConfigSchema.parse(value);
}

export const createAttemptSchema = z.object({
  username: z.string().trim().min(1).max(100),
  theme: z.enum(["light", "dark"]).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const completeAttemptSchema = z.object({
  providerToken: z.string().min(1).max(8192),
});

export const outageTicketSchema = z.object({
  username: z.string().trim().min(1).max(100),
});

export const recoveryLoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1024),
  recoveryKey: z.string().length(32).regex(/^(?=.*[a-z])(?=.*\d)[a-z\d]+$/),
  outageTicket: z.string().min(20).max(256),
});

export const createProviderSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string().trim().min(1).max(100), type: z.literal("custom"), config: customConfigSchema }),
  z.object({ name: z.string().trim().min(1).max(100), type: z.literal("turnstile"), config: turnstileConfigSchema }),
  z.object({ name: z.string().trim().min(1).max(100), type: z.literal("recaptcha_v2_invisible"), config: recaptchaConfigSchema }),
]);

export const updateProviderSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  config: z.union([customConfigSchema, turnstileConfigSchema, recaptchaConfigSchema]).optional(),
}).refine((value) => value.name !== undefined || value.config !== undefined, "At least one field is required");

export const updatePolicySchema = z.object({
  enabled: z.boolean().optional(),
  level: z.enum(["low", "medium", "high"]).optional(),
}).refine((value) => value.enabled !== undefined || value.level !== undefined, "At least one field is required");
