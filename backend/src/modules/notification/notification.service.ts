import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  NotificationQueryInput,
  MarkReadInput,
  CreateNotificationInput,
} from "./notification.schema";

export async function getNotifications(
  userId: string,
  query: NotificationQueryInput
) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {
    user_id: userId,
  };

  if (query.unread_only) {
    where.status = "unread";
  } else if (query.status) {
    where.status = query.status;
  }

  if (query.type) {
    where.type = query.type;
  }

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { user_id: userId, status: "unread" },
    }),
  ]);

  return {
    notifications,
    unreadCount,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function markAsRead(userId: string, data: MarkReadInput) {
  if (data.mark_all) {
    await prisma.notification.updateMany({
      where: { user_id: userId, status: "unread" },
      data: { status: "read", read_at: new Date() },
    });
    return { marked: "all" };
  }

  if (data.notification_ids && data.notification_ids.length > 0) {
    await prisma.notification.updateMany({
      where: {
        id: { in: data.notification_ids },
        user_id: userId,
      },
      data: { status: "read", read_at: new Date() },
    });
    return { marked: data.notification_ids.length };
  }

  return { marked: 0 };
}

export async function dismissNotification(
  userId: string,
  notificationId: string
) {
  const notification = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      user_id: userId,
    },
    data: { status: "dismissed" },
  });

  if (notification.count === 0) {
    throw new AppError("Notification not found", "NOT_FOUND", 404);
  }

  return { success: true };
}

export async function createNotification(data: CreateNotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      user_id: data.user_id,
      type: data.type,
      title: data.title,
      content: data.content,
      project_id: data.project_id,
      task_id: data.task_id,
      actor_id: data.actor_id,
      channels: JSON.stringify(["in_app"]),
    },
  });

  return notification;
}

export async function getUnreadCount(userId: string) {
  const count = await prisma.notification.count({
    where: { user_id: userId, status: "unread" },
  });

  return { count };
}
