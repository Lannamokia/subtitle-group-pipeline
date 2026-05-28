import { z } from "zod";
import { WikiStatus } from "@prisma/client";

export const createWikiSchema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1, "Title is required").max(500),
  slug: z.string().min(1, "Slug is required").max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  content: z.string().min(1, "Content is required"),
  status: z.nativeEnum(WikiStatus).default(WikiStatus.draft),
  require_approval: z.boolean().default(false),
});

export const updateWikiSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  status: z.nativeEnum(WikiStatus).optional(),
});

export const wikiQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  status: z.nativeEnum(WikiStatus).optional(),
  search: z.string().optional(),
});

export const approveWikiSchema = z.object({
  approved: z.boolean(),
  rejection_reason: z.string().optional().nullable(),
});

export const createCommentSchema = z.object({
  content: z.string().min(1, "Comment is required").max(5000),
  file_version_id: z.string().uuid().optional().nullable(),
  wiki_id: z.string().uuid().optional().nullable(),
  line_number: z.number().int().min(1).optional().nullable(),
  parent_id: z.string().uuid().optional().nullable(),
});

export type CreateWikiInput = z.infer<typeof createWikiSchema>;
export type UpdateWikiInput = z.infer<typeof updateWikiSchema>;
export type WikiQueryInput = z.infer<typeof wikiQuerySchema>;
export type ApproveWikiInput = z.infer<typeof approveWikiSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
