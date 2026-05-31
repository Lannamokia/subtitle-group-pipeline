import { z } from "zod";
import { FileType, TaskRole } from "@prisma/client";

export const fileQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  uploader_id: z.string().uuid().optional(),
  uploaderId: z.string().uuid().optional(),
  role: z.nativeEnum(TaskRole).optional(),
  tag: z.string().max(100).optional(),
  tags: z.string().max(500).optional(),
  uploaded_from: z.string().datetime().optional(),
  uploadedFrom: z.string().datetime().optional(),
  uploaded_to: z.string().datetime().optional(),
  uploadedTo: z.string().datetime().optional(),
  file_type: z.nativeEnum(FileType).optional(),
  type: z.nativeEnum(FileType).optional(),
  search: z.string().optional(),
  include_deleted: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .default("false"),
});

export const uploadFileSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  name: z.string().min(1, "File name is required").max(500),
  file_type: z.nativeEnum(FileType),
  mime_type: z.string().min(1, "MIME type is required"),
  size_bytes: z.number().int().min(0),
  storage_path: z.string().min(1, "Storage path is required"),
  storage_backend_id: z.string().uuid().optional().nullable(),
  checksum: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(), // JSON string
  tags: z.string().optional().nullable(), // JSON string array
  task_id: z.string().uuid("Invalid task ID").optional(),
  taskId: z.string().uuid("Invalid task ID").optional(),
  unit_id: z.string().uuid("Invalid unit ID").optional(),
  unitId: z.string().uuid("Invalid unit ID").optional(),
  role: z.nativeEnum(TaskRole).optional(),
  episode_length: z.coerce.number().int().min(1).optional().nullable(),
  episodeLength: z.coerce.number().int().min(1).optional().nullable(),
  change_summary: z.string().max(1000).optional().nullable(),
});

export const replaceFileSchema = z.object({
  name: z.string().min(1, "File name is required").max(500).optional(),
  mime_type: z.string().min(1, "MIME type is required"),
  size_bytes: z.number().int().min(0),
  storage_path: z.string().min(1, "Storage path is required"),
  storage_backend_id: z.string().uuid().optional().nullable(),
  checksum: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
  change_summary: z.string().max(1000).optional().nullable(),
});

const multipartUploadBaseObject = z.object({
  project_id: z.string().uuid("Invalid project ID").optional(),
  projectId: z.string().uuid("Invalid project ID").optional(),
  file_id: z.string().uuid("Invalid file ID").optional(),
  fileId: z.string().uuid("Invalid file ID").optional(),
  name: z.string().min(1, "File name is required").max(500),
  file_type: z.nativeEnum(FileType).optional(),
  type: z.nativeEnum(FileType).optional(),
  mime_type: z.string().min(1, "MIME type is required").optional(),
  mimeType: z.string().min(1, "MIME type is required").optional(),
  size_bytes: z.coerce.number().int().min(0).optional(),
  sizeBytes: z.coerce.number().int().min(0).optional(),
  task_id: z.string().uuid("Invalid task ID").optional(),
  taskId: z.string().uuid("Invalid task ID").optional(),
  unit_id: z.string().uuid("Invalid unit ID").optional(),
  unitId: z.string().uuid("Invalid unit ID").optional(),
  role: z.nativeEnum(TaskRole).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  metadata: z.string().optional().nullable(),
  episode_length: z.coerce.number().int().min(1).optional().nullable(),
  episodeLength: z.coerce.number().int().min(1).optional().nullable(),
  change_summary: z.string().max(1000).optional().nullable(),
  changeSummary: z.string().max(1000).optional().nullable(),
});

const multipartUploadBaseSchema = multipartUploadBaseObject.refine((data) => data.project_id || data.projectId || data.file_id || data.fileId, {
  message: "project_id or file_id is required",
}).refine((data) => data.mime_type || data.mimeType, {
  message: "mime_type is required",
}).refine((data) => data.size_bytes !== undefined || data.sizeBytes !== undefined, {
  message: "size_bytes is required",
});

export const initiateMultipartUploadSchema = multipartUploadBaseSchema;

export const signMultipartPartSchema = z.object({
  storage_backend_id: z.string().uuid("Invalid storage backend ID"),
  storageBackendId: z.string().uuid("Invalid storage backend ID").optional(),
  key: z.string().min(1, "Storage key is required"),
  upload_id: z.string().min(1, "Upload ID is required").optional(),
  uploadId: z.string().min(1, "Upload ID is required").optional(),
  part_number: z.coerce.number().int().min(1).max(10000).optional(),
  partNumber: z.coerce.number().int().min(1).max(10000).optional(),
}).refine((data) => data.upload_id || data.uploadId, {
  message: "upload_id is required",
}).refine((data) => data.part_number !== undefined || data.partNumber !== undefined, {
  message: "part_number is required",
});

const completedPartSchema = z.object({
  part_number: z.coerce.number().int().min(1).max(10000).optional(),
  partNumber: z.coerce.number().int().min(1).max(10000).optional(),
  e_tag: z.string().min(1).optional(),
  eTag: z.string().min(1).optional(),
  ETag: z.string().min(1).optional(),
}).refine((data) => data.part_number !== undefined || data.partNumber !== undefined, {
  message: "part_number is required",
}).refine((data) => data.e_tag || data.eTag || data.ETag, {
  message: "eTag is required",
});

export const completeMultipartUploadSchema = multipartUploadBaseObject.extend({
  storage_backend_id: z.string().uuid("Invalid storage backend ID"),
  storageBackendId: z.string().uuid("Invalid storage backend ID").optional(),
  key: z.string().min(1, "Storage key is required"),
  upload_id: z.string().min(1, "Upload ID is required").optional(),
  uploadId: z.string().min(1, "Upload ID is required").optional(),
  parts: z.array(completedPartSchema).min(1).max(10000),
}).refine((data) => data.project_id || data.projectId || data.file_id || data.fileId, {
  message: "project_id or file_id is required",
}).refine((data) => data.mime_type || data.mimeType, {
  message: "mime_type is required",
}).refine((data) => data.size_bytes !== undefined || data.sizeBytes !== undefined, {
  message: "size_bytes is required",
}).refine((data) => data.upload_id || data.uploadId, {
  message: "upload_id is required",
});

export const abortMultipartUploadSchema = z.object({
  storage_backend_id: z.string().uuid("Invalid storage backend ID"),
  storageBackendId: z.string().uuid("Invalid storage backend ID").optional(),
  key: z.string().min(1, "Storage key is required"),
  upload_id: z.string().min(1, "Upload ID is required").optional(),
  uploadId: z.string().min(1, "Upload ID is required").optional(),
}).refine((data) => data.upload_id || data.uploadId, {
  message: "upload_id is required",
});

export const createVersionSchema = z.object({
  storage_path: z.string().min(1, "Storage path is required"),
  size_bytes: z.number().int().min(0),
  checksum: z.string().optional().nullable(),
  change_summary: z.string().max(1000).optional().nullable(),
});

export const approveVersionSchema = z.object({
  approved: z.boolean().default(true),
});

export const createLinkSchema = z.object({
  project_id: z.string().uuid("Invalid project ID").optional(),
  projectId: z.string().uuid("Invalid project ID").optional(),
  file_id: z.string().uuid("Invalid file ID").optional().nullable(),
  task_id: z.string().uuid("Invalid task ID").optional(),
  taskId: z.string().uuid("Invalid task ID").optional(),
  unit_id: z.string().uuid("Invalid unit ID").optional(),
  unitId: z.string().uuid("Invalid unit ID").optional(),
  role: z.nativeEnum(TaskRole).optional(),
  file_type: z.nativeEnum(FileType).optional(),
  type: z.nativeEnum(FileType).optional(),
  url: z.string().url("Invalid URL"),
  link_type: z.string().min(1, "Link type is required").default("cloud_drive"),
  name: z.string().max(500).optional(),
  extractCode: z.string().max(100).optional(),
  extract_code: z.string().max(100).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  episode_length: z.coerce.number().int().min(1).optional().nullable(),
  episodeLength: z.coerce.number().int().min(1).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
});

export const updateUploadPolicySchema = z.object({
  allowed_types: z.string(), // JSON string: array or role matrix object
  max_size_bytes: z.number().int().min(1).optional(),
  require_approval: z.boolean().optional(),
  extension_whitelist: z.string().optional().nullable(), // JSON string
});

export const downloadLinkQuerySchema = z.object({
  ttl: z.string().optional().transform(Number).default("300"),
});

export const batchAssignTasksSchema = z.object({
  unit_id: z.string().uuid("Invalid unit ID").optional(),
  unitId: z.string().uuid("Invalid unit ID").optional(),
  assignee_id: z.string().uuid("Invalid assignee ID").optional(),
  assigneeId: z.string().uuid("Invalid assignee ID").optional(),
  role: z.nativeEnum(TaskRole).optional(),
}).refine((data) => data.unit_id || data.unitId, {
  message: "unit_id is required",
}).refine((data) => data.assignee_id || data.assigneeId, {
  message: "assignee_id is required",
});

export const batchArchiveUnitsSchema = z.object({
  project_id: z.string().uuid("Invalid project ID").optional(),
  projectId: z.string().uuid("Invalid project ID").optional(),
}).refine((data) => data.project_id || data.projectId, {
  message: "project_id is required",
});

export type FileQueryInput = z.infer<typeof fileQuerySchema>;
export type UploadFileInput = z.infer<typeof uploadFileSchema>;
export type ReplaceFileInput = z.infer<typeof replaceFileSchema>;
export type InitiateMultipartUploadInput = z.infer<typeof initiateMultipartUploadSchema>;
export type SignMultipartPartInput = z.infer<typeof signMultipartPartSchema>;
export type CompleteMultipartUploadInput = z.infer<typeof completeMultipartUploadSchema>;
export type AbortMultipartUploadInput = z.infer<typeof abortMultipartUploadSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type ApproveVersionInput = z.infer<typeof approveVersionSchema>;
export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export type UpdateUploadPolicyInput = z.infer<typeof updateUploadPolicySchema>;
export type DownloadLinkQueryInput = z.infer<typeof downloadLinkQuerySchema>;
export type BatchAssignTasksInput = z.infer<typeof batchAssignTasksSchema>;
export type BatchArchiveUnitsInput = z.infer<typeof batchArchiveUnitsSchema>;
