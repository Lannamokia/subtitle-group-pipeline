import { z } from "zod";
import { AnnouncementType } from "@prisma/client";

export const createAnnouncementSchema = z.object({
  type: z.nativeEnum(AnnouncementType).default(AnnouncementType.global),
  project_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1, "Title is required").max(500),
  content: z.string().min(1, "Content is required").max(10000),
  is_pinned: z.boolean().default(false),
  expires_at: z.string().datetime().optional().nullable(),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(10000).optional(),
  is_pinned: z.boolean().optional(),
  is_active: z.boolean().optional(),
  expires_at: z.string().datetime().optional().nullable(),
});

export const announcementQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  type: z.nativeEnum(AnnouncementType).optional(),
  project_id: z.string().uuid().optional(),
  include_inactive: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .default("false"),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type AnnouncementQueryInput = z.infer<typeof announcementQuerySchema>;
