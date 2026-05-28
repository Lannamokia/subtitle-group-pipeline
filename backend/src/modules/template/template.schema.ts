import { z } from "zod";
import { ProjectType } from "@prisma/client";

export const createTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  project_type: z.nativeEnum(ProjectType).default(ProjectType.anime),
  roles: z.string().default("[]"), // JSON string
  upload_policy: z.string().default("{}"), // JSON string
  notification_policy: z.string().default("{}"), // JSON string
  ass_policy: z.string().default("{}"), // JSON string
  product_config: z.string().default("{}"), // JSON string
  delivery_checklist: z.string().default("[]"), // JSON string
  is_default: z.boolean().default(false),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const templateQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_type: z.nativeEnum(ProjectType).optional(),
  search: z.string().optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type TemplateQueryInput = z.infer<typeof templateQuerySchema>;
