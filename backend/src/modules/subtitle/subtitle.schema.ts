import { z } from "zod";
import { ConflictType, ResolutionStatus } from "@prisma/client";

// Translation Claims
export const createTranslationClaimSchema = z.object({
  start_time: z.number().int().min(0, "Start time must be non-negative"),
  end_time: z.number().int().min(0, "End time must be non-negative"),
});

export const claimQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  status: z.string().optional(),
});

// Translation Submissions
export const submitTranslationSchema = z.object({
  content: z.string().optional().nullable(),
  ass_content: z.string().optional().nullable(),
  line_count: z.number().int().optional(),
});

// Merge Jobs
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

export const createUnitMergeJobSchema = z.object({
  claim_ids: z.array(z.string().uuid()).min(1, "At least one claim ID is required"),
});

// Conflicts
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

// Version Comparison
export const compareVersionsSchema = z.object({
  file_version_id_1: z.string().uuid("Invalid file version ID"),
  file_version_id_2: z.string().uuid("Invalid file version ID"),
});

// Reviews
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

// Export types
export type CreateTranslationClaimInput = z.infer<typeof createTranslationClaimSchema>;
export type ClaimQueryInput = z.infer<typeof claimQuerySchema>;
export type SubmitTranslationInput = z.infer<typeof submitTranslationSchema>;
export type MergeJobQueryInput = z.infer<typeof mergeJobQuerySchema>;
export type CreateMergeJobInput = z.infer<typeof createMergeJobSchema>;
export type CreateUnitMergeJobInput = z.infer<typeof createUnitMergeJobSchema>;
export type ConflictQueryInput = z.infer<typeof conflictQuerySchema>;
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;
export type CompareVersionsInput = z.infer<typeof compareVersionsSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;
