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
  role: z.nativeEnum(TaskRole).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
});

export const updateTaskDeadlineSchema = z.object({
  due_date: z.string().datetime("Invalid date format"),
});

export const taskQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  project_id: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  role: z.nativeEnum(TaskRole).optional(),
  assignee_id: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
});

export const claimSegmentSchema = z.object({
  segment_start: z.number().int().min(0),
  segment_end: z.number().int().min(0),
});

export const submitTranslationSchema = z.object({
  content: z.string().min(1, "Content is required"),
  line_count: z.number().int().optional(),
});

export const createDependencySchema = z.object({
  depends_on_id: z.string().uuid("Invalid task ID"),
  dependency_type: z.string().default("finish_to_start"),
});

export const reviewTaskSchema = z.object({
  approved: z.boolean(),
  comments: z.string().optional().nullable(),
  line_comments: z.string().optional().nullable(), // JSON string
});

export const resetTaskSchema = z.object({
  reason: z.string().optional().nullable(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateTaskDeadlineInput = z.infer<typeof updateTaskDeadlineSchema>;
export type TaskQueryInput = z.infer<typeof taskQuerySchema>;
export type ClaimSegmentInput = z.infer<typeof claimSegmentSchema>;
export type SubmitTranslationInput = z.infer<typeof submitTranslationSchema>;
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;
export type ReviewTaskInput = z.infer<typeof reviewTaskSchema>;
export type ResetTaskInput = z.infer<typeof resetTaskSchema>;
