import { z } from "zod";
import { TaskRole, TaskStatus } from "@prisma/client";

export const createTaskSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  unit_id: z.string().uuid("Invalid unit ID").optional().nullable(),
  title: z.string().min(1, "Task title is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  role: z.nativeEnum(TaskRole),
  assignee_id: z.string().uuid("Invalid user ID").optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.nativeEnum(TaskStatus).optional(),
  role: z.nativeEnum(TaskRole).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
});

export const taskQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  role: z.nativeEnum(TaskRole).optional(),
  assignee_id: z.string().uuid().optional(),
});

export const claimSegmentSchema = z.object({
  segment_start: z.number().int().min(1),
  segment_end: z.number().int().min(1),
});

export const submitTranslationSchema = z.object({
  content: z.string().min(1, "Content is required"),
  line_count: z.number().int().optional(),
});

export const createDependencySchema = z.object({
  depends_on_id: z.string().uuid("Invalid task ID"),
  dependency_type: z.string().default("finish_to_start"),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskQueryInput = z.infer<typeof taskQuerySchema>;
export type ClaimSegmentInput = z.infer<typeof claimSegmentSchema>;
export type SubmitTranslationInput = z.infer<typeof submitTranslationSchema>;
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;
