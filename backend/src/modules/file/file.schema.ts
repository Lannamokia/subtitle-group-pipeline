import { z } from "zod";
import { FileType } from "@prisma/client";

export const fileQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  file_type: z.nativeEnum(FileType).optional(),
  search: z.string().optional(),
  include_deleted: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .default("false"),
});

export const createFileSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  name: z.string().min(1, "File name is required").max(500),
  file_type: z.nativeEnum(FileType),
  mime_type: z.string().min(1, "MIME type is required"),
  size_bytes: z.number().int().min(0),
  storage_path: z.string().min(1, "Storage path is required"),
  checksum: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(), // JSON string
});

export const createVersionSchema = z.object({
  storage_path: z.string().min(1, "Storage path is required"),
  size_bytes: z.number().int().min(0),
  checksum: z.string().optional().nullable(),
  change_summary: z.string().max(1000).optional().nullable(),
});

export const createLinkSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  file_id: z.string().uuid("Invalid file ID").optional().nullable(),
  url: z.string().url("Invalid URL"),
  link_type: z.string().min(1, "Link type is required"),
  description: z.string().max(1000).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
});

export const updateUploadPolicySchema = z.object({
  allowed_types: z.string(), // JSON string
  max_size_bytes: z.number().int().min(1).optional(),
  require_approval: z.boolean().optional(),
  extension_whitelist: z.string().optional().nullable(), // JSON string
});

export type FileQueryInput = z.infer<typeof fileQuerySchema>;
export type CreateFileInput = z.infer<typeof createFileSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export type UpdateUploadPolicyInput = z.infer<typeof updateUploadPolicySchema>;
