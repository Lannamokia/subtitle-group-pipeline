import { z } from "zod";
import { ConflictType, ResolutionStatus } from "@prisma/client";

export const mergeJobQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  status: z.string().optional(),
});

export const createMergeJobSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  unit_id: z.string().uuid().optional().nullable(),
  input_files: z.string().min(1, "Input files JSON is required"), // JSON array of file IDs
});

export const conflictQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  conflict_type: z.nativeEnum(ConflictType).optional(),
  resolution: z.nativeEnum(ResolutionStatus).optional(),
});

export const resolveConflictSchema = z.object({
  resolution: z.nativeEnum(ResolutionStatus),
  resolution_note: z.string().max(2000).optional().nullable(),
});

export const reviewSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  task_id: z.string().uuid().optional().nullable(),
  file_version_id: z.string().uuid().optional().nullable(),
  status: z.enum(["pending", "approved", "rejected", "needs_revision"]),
  comments: z.string().max(10000).optional().nullable(),
  line_comments: z.string().optional().nullable(), // JSON string
});

export const createSnapshotSchema = z.object({
  file_id: z.string().uuid("Invalid file ID"),
  version_number: z.number().int().min(1),
  content: z.string().min(1, "Content is required"),
});

export type MergeJobQueryInput = z.infer<typeof mergeJobQuerySchema>;
export type CreateMergeJobInput = z.infer<typeof createMergeJobSchema>;
export type ConflictQueryInput = z.infer<typeof conflictQuerySchema>;
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;
