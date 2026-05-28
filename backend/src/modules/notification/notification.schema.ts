import { z } from "zod";
import { NotificationType, NotificationStatus } from "@prisma/client";

export const notificationQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  status: z.nativeEnum(NotificationStatus).optional(),
  type: z.nativeEnum(NotificationType).optional(),
  unread_only: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .default("false"),
});

export const markReadSchema = z.object({
  notification_ids: z.array(z.string().uuid()).optional(),
  mark_all: z.boolean().default(false),
});

export const createNotificationSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  type: z.nativeEnum(NotificationType),
  title: z.string().min(1, "Title is required").max(500),
  content: z.string().max(5000).optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  task_id: z.string().uuid().optional().nullable(),
  actor_id: z.string().uuid().optional().nullable(),
});

export const updatePreferencesSchema = z.object({
  email_enabled: z.boolean().optional(),
  qq_enabled: z.boolean().optional(),
  in_site_enabled: z.boolean().optional(),
  email_escalation_min: z.number().int().min(1).max(10080).optional(),
  qq_escalation_min: z.number().int().min(1).max(10080).optional(),
  task_assigned: z.boolean().optional(),
  task_completed: z.boolean().optional(),
  task_reassigned: z.boolean().optional(),
  review_requested: z.boolean().optional(),
  review_approved: z.boolean().optional(),
  review_rejected: z.boolean().optional(),
  join_approved: z.boolean().optional(),
  file_uploaded: z.boolean().optional(),
  mention: z.boolean().optional(),
  task_overdue: z.boolean().optional(),
  conflict_detected: z.boolean().optional(),
  downstream_reset: z.boolean().optional(),
});

export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>;
export type MarkReadInput = z.infer<typeof markReadSchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
