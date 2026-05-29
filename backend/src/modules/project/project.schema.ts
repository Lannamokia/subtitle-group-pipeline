import { z } from "zod";
import { ProjectStatus, ProjectType, TaskRole } from "@prisma/client";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  project_type: z.nativeEnum(ProjectType).default(ProjectType.anime),
  template_id: z.string().uuid().optional().nullable(),
  storage_backend_id: z.string().uuid().optional().nullable(),
});

export const createProjectFromTemplateSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  template_id: z.string().uuid("Template ID is required"),
  storage_backend_id: z.string().uuid("Storage backend ID is required"),
  season_count: z.number().int().min(1).default(1),
  units_per_season: z.number().int().min(1).default(12),
  episode_length: z.number().int().min(1).optional().nullable(), // in seconds
});

const deliveryItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.nativeEnum(TaskRole),
  required: z.boolean().default(true),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.nativeEnum(ProjectStatus).optional(),
  current_season: z.number().int().min(1).optional(),
  delivery_checklist: z.array(deliveryItemSchema).optional(),
  download_link_ttl_seconds: z.number().int().min(90).optional().nullable(),
  wiki_approval_required: z.boolean().optional().nullable(),
});

export const projectQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(ProjectStatus).optional(),
  project_type: z.nativeEnum(ProjectType).optional(),
  supervisor_id: z.string().uuid().optional(),
  search: z.string().optional(),
  include_archived: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .default("false"),
  include_deleted: z
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

export const updateJoinRequestSchema = z.object({
  approved: z.boolean(),
});

export const createProjectAnnouncementSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  content: z.string().min(1, "Content is required").max(10000),
  is_pinned: z.boolean().default(false),
  expires_at: z.string().datetime().optional().nullable(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateProjectFromTemplateInput = z.infer<typeof createProjectFromTemplateSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectQueryInput = z.infer<typeof projectQuerySchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type JoinRequestInput = z.infer<typeof joinRequestSchema>;
export type UpdateJoinRequestInput = z.infer<typeof updateJoinRequestSchema>;
