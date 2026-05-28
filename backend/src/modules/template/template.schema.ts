import { z } from "zod";
import { ProjectType } from "@prisma/client";

export const templateRoleSchema = z.object({
  role: z.enum([
    "source",
    "timing",
    "translation",
    "post_production",
    "encoding",
    "release",
    "supervisor",
  ]),
  enabled: z.boolean().default(true),
  slotCount: z.number().int().min(1).default(1),
  assignmentStrategy: z.enum(["manual", "open_claim"]).default("manual"),
  maxSegmentLength: z.number().int().min(1).optional(), // for translation role
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  project_type: z.nativeEnum(ProjectType).default(ProjectType.anime),
  roles: z.string().default("[]"), // JSON string of templateRoleSchema[]
  upload_policy: z.string().default("{}"), // JSON string
  notification_policy: z.string().default("{}"), // JSON string
  ass_policy: z.string().default("{}"), // JSON string
  product_config: z.string().default("{}"), // JSON string
  delivery_checklist: z.string().default("[]"), // JSON string
  release_task_type: z
    .enum(["torrent", "torrent+cloud_drive", "cloud_drive", "other"])
    .default("torrent"),
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
export type TemplateRoleConfig = z.infer<typeof templateRoleSchema>;
