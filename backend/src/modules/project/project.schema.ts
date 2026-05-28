import { z } from "zod";
import { ProjectStatus, ProjectType, TaskRole } from "@prisma/client";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  project_type: z.nativeEnum(ProjectType).default(ProjectType.anime),
  template_id: z.string().uuid().optional().nullable(),
  storage_backend_id: z.string().uuid().optional().nullable(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.nativeEnum(ProjectStatus).optional(),
  current_season: z.number().int().min(1).optional(),
});

export const projectQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  status: z.nativeEnum(ProjectStatus).optional(),
  project_type: z.nativeEnum(ProjectType).optional(),
  search: z.string().optional(),
  include_archived: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .default("false"),
});

export const addMemberSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  role: z.nativeEnum(TaskRole),
  is_lead: z.boolean().default(false),
});

export const updateMemberSchema = z.object({
  role: z.nativeEnum(TaskRole).optional(),
  is_lead: z.boolean().optional(),
});

export const createUnitSchema = z.object({
  season_number: z.number().int().min(1).default(1),
  unit_number: z.number().int().min(1),
  title: z.string().max(500).optional().nullable(),
  episode_length: z.number().int().min(1).optional().nullable(),
  air_date: z.string().datetime().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

export const joinRequestSchema = z.object({
  role: z.nativeEnum(TaskRole),
  message: z.string().max(1000).optional().nullable(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectQueryInput = z.infer<typeof projectQuerySchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type JoinRequestInput = z.infer<typeof joinRequestSchema>;
