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

export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>;
export type MarkReadInput = z.infer<typeof markReadSchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
