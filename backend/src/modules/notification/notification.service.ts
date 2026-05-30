import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { NotificationChannel, NotificationStatus, DeliveryStatus, type NotificationType } from "@prisma/client";
import type {
  NotificationQueryInput,
  MarkReadInput,
  CreateNotificationInput,
  UpdatePreferencesInput,
} from "./notification.schema";
import { renderNotificationTemplate, getNotificationTypePreferenceKey } from "./templates";
import { executeDelivery, retryFailedDelivery, sendQQGroupNotification } from "./delivery.service";

export { sendQQGroupNotification };

// ==================== Core Notification CRUD ====================

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
        deliveries: {
          select: {
            id: true,
            channel: true,
            status: true,
            sent_at: true,
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

export async function getUnreadCount(userId: string) {
  const count = await prisma.notification.count({
    where: { user_id: userId, status: "unread" },
  });
  return { count };
}

export async function markAsRead(userId: string, notificationId: string) {
  const notification = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      user_id: userId,
      status: "unread",
    },
    data: { status: "read", read_at: new Date() },
  });

  if (notification.count === 0) {
    throw new AppError("Notification not found or already read", "NOT_FOUND", 404);
  }

  return { success: true };
}

export async function markAllAsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { user_id: userId, status: "unread" },
    data: { status: "read", read_at: new Date() },
  });

  return { marked: result.count };
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

// ==================== Notification Creation with Channel Delivery ====================

export interface NotificationContext {
  projectId?: string;
  taskId?: string;
  actorId?: string;
  groupId?: string;
  taskName?: string;
  projectName?: string;
  actorName?: string;
  fileName?: string;
  reason?: string;
  extra?: Record<string, unknown>;
}

async function resolveNotificationReferenceIds(context: NotificationContext) {
  const [project, task, actor] = await Promise.all([
    context.projectId
      ? prisma.project.findUnique({ where: { id: context.projectId }, select: { id: true } })
      : Promise.resolve(null),
    context.taskId
      ? prisma.task.findUnique({ where: { id: context.taskId }, select: { id: true } })
      : Promise.resolve(null),
    context.actorId
      ? prisma.user.findUnique({ where: { id: context.actorId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  return {
    projectId: project?.id,
    taskId: task?.id,
    actorId: actor?.id,
  };
}

export async function createNotification(
  userId: string,
  type: NotificationType,
  context: NotificationContext
) {
  const { title, content } = renderNotificationTemplate(type, {
    taskName: context.taskName,
    projectName: context.projectName,
    actorName: context.actorName,
    fileName: context.fileName,
    reason: context.reason,
  });

  const referenceIds = await resolveNotificationReferenceIds(context);

  const notification = await prisma.notification.create({
    data: {
      user_id: userId,
      type,
      title,
      content,
      project_id: referenceIds.projectId,
      task_id: referenceIds.taskId,
      actor_id: referenceIds.actorId,
      channels: JSON.stringify([NotificationChannel.in_site]),
    },
  });

  // Deliver to in-site channel immediately
  await executeDelivery({
    notificationId: notification.id,
    channel: NotificationChannel.in_site,
    recipient: { userId },
    payload: { subject: title, body: content || "" },
  });

  // Attempt to deliver to other enabled channels
  await deliverToChannels(notification.id, userId, type, title, content || "", context);

  return notification;
}

async function deliverToChannels(
  notificationId: string,
  userId: string,
  type: NotificationType,
  title: string,
  content: string,
  context: NotificationContext
) {
  const [user, project] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        qq_number: true,
        notification_preferences: true,
      },
    }),
    context.projectId
      ? prisma.project.findUnique({
          where: { id: context.projectId },
          select: { qq_group_id: true },
        })
      : Promise.resolve(null),
  ]);

  if (!user) return;

  const prefs = user.notification_preferences || await getOrCreateDefaultPreferences(userId);
  const prefKey = getNotificationTypePreferenceKey(type) as keyof typeof prefs;

  // Check if this notification type is enabled for the user
  if (prefs[prefKey] === false) return;

  const channels: NotificationChannel[] = [];

  if (prefs.email_enabled && user.email) {
    channels.push(NotificationChannel.email);
  }

  if (prefs.qq_enabled && user.qq_number) {
    channels.push(NotificationChannel.qq);
  }

  for (const channel of channels) {
    try {
      await executeDelivery({
        notificationId,
        channel,
        recipient: {
          userId,
          email: user.email,
          qqNumber: user.qq_number,
        },
        payload: {
          subject: title,
          body: content,
          groupId:
            context.groupId ||
            (typeof context.extra?.qq_group_id === "string" ? context.extra.qq_group_id : undefined) ||
            project?.qq_group_id ||
            undefined,
          notificationType: type,
        },
      });
    } catch (error) {
      // Failed deliveries are logged but don't block main flow
      console.error(`[NotificationService] Channel delivery failed for ${channel}:`, error);
    }
  }
}

// ==================== Recipient Resolution ====================

export interface EventContext {
  projectId?: string;
  taskId?: string;
  actorId?: string;
  reviewId?: string;
  fileId?: string;
  joinRequestId?: string;
  commentContent?: string;
}

export async function resolveRecipients(
  eventType: NotificationType,
  context: EventContext
): Promise<string[]> {
  const recipients: string[] = [];

  switch (eventType) {
    case "task_assigned":
      if (context.taskId) {
        const task = await prisma.task.findUnique({
          where: { id: context.taskId },
          select: { assignee_id: true },
        });
        if (task?.assignee_id) recipients.push(task.assignee_id);
      }
      break;

    case "task_reassigned":
      // Previous assignee gets notified - handled by caller passing previousAssigneeId
      break;

    case "task_completed":
      if (context.taskId) {
        const task = await prisma.task.findUnique({
          where: { id: context.taskId },
          select: { creator_id: true, assignee_id: true },
        });
        if (task) {
          if (task.creator_id !== context.actorId) recipients.push(task.creator_id);
          if (task.assignee_id && task.assignee_id !== context.actorId) {
            recipients.push(task.assignee_id);
          }
        }
      }
      break;

    case "review_requested":
      if (context.reviewId) {
        const review = await prisma.review.findUnique({
          where: { id: context.reviewId },
          select: { reviewer_id: true },
        });
        if (review?.reviewer_id) recipients.push(review.reviewer_id);
      }
      break;

    case "review_approved":
    case "review_rejected":
      if (context.reviewId) {
        const review = await prisma.review.findUnique({
          where: { id: context.reviewId },
          select: { requester_id: true },
        });
        if (review?.requester_id) recipients.push(review.requester_id);
      }
      break;

    case "join_approved":
    case "join_rejected":
      if (context.joinRequestId) {
        const req = await prisma.joinRequest.findUnique({
          where: { id: context.joinRequestId },
          select: { user_id: true, approved_by: true },
        });
        if (req?.user_id) recipients.push(req.user_id);
        if (req?.approved_by) recipients.push(req.approved_by);
      }
      break;

    case "project_update":
      if (context.projectId) {
        const members = await prisma.projectMember.findMany({
          where: { project_id: context.projectId, left_at: null },
          select: { user_id: true },
        });
        for (const member of members) recipients.push(member.user_id);

        const project = await prisma.project.findUnique({
          where: { id: context.projectId },
          select: { owner_id: true },
        });
        if (project?.owner_id) recipients.push(project.owner_id);
      }
      break;

    case "file_uploaded":
      // Notify project members (excluding uploader)
      if (context.projectId && context.actorId) {
        const members = await prisma.projectMember.findMany({
          where: { project_id: context.projectId },
          select: { user_id: true },
        });
        for (const m of members) {
          if (m.user_id !== context.actorId) recipients.push(m.user_id);
        }

        const project = await prisma.project.findUnique({
          where: { id: context.projectId },
          select: { owner_id: true },
        });
        if (project?.owner_id && project.owner_id !== context.actorId) {
          recipients.push(project.owner_id);
        }
      }
      break;

    case "mention":
      // Extract @mentions from comment content
      if (context.commentContent) {
        const mentioned = extractMentions(context.commentContent);
        for (const username of mentioned) {
          const user = await prisma.user.findUnique({
            where: { username },
            select: { id: true },
          });
          if (user) recipients.push(user.id);
        }
      }
      break;

    case "join_request":
      // Notify project supervisors/admins
      if (context.projectId) {
        const supervisors = await prisma.projectMember.findMany({
          where: {
            project_id: context.projectId,
            OR: [
              { is_lead: true },
              { role: "supervisor" },
            ],
          },
          select: { user_id: true },
        });
        for (const s of supervisors) recipients.push(s.user_id);

        // Also notify project owner
        const project = await prisma.project.findUnique({
          where: { id: context.projectId },
          select: { owner_id: true },
        });
        if (project?.owner_id) {
          recipients.push(project.owner_id);
        }
      }
      break;

    case "conflict_detected":
      // Notify project supervisors
      if (context.projectId) {
        const supervisors = await prisma.projectMember.findMany({
          where: {
            project_id: context.projectId,
            OR: [
              { is_lead: true },
              { role: "supervisor" },
            ],
          },
          select: { user_id: true },
        });
        for (const s of supervisors) recipients.push(s.user_id);

        const project = await prisma.project.findUnique({
          where: { id: context.projectId },
          select: { owner_id: true },
        });
        if (project?.owner_id) {
          recipients.push(project.owner_id);
        }
      }
      break;

    case "downstream_reset":
      if (context.taskId) {
        const task = await prisma.task.findUnique({
          where: { id: context.taskId },
          select: { assignee_id: true },
        });
        if (task?.assignee_id) recipients.push(task.assignee_id);
      }
      break;

    case "task_overdue":
      if (context.taskId) {
        const task = await prisma.task.findUnique({
          where: { id: context.taskId },
          select: { assignee_id: true, project_id: true },
        });
        if (task?.assignee_id) recipients.push(task.assignee_id);
        // Also notify supervisors
        if (task?.project_id) {
          const supervisors = await prisma.projectMember.findMany({
            where: {
              project_id: task.project_id,
              OR: [
                { is_lead: true },
                { role: "supervisor" },
              ],
            },
            select: { user_id: true },
          });
          for (const s of supervisors) {
            if (!recipients.includes(s.user_id)) {
              recipients.push(s.user_id);
            }
          }

          const project = await prisma.project.findUnique({
            where: { id: task.project_id },
            select: { owner_id: true },
          });
          if (project?.owner_id && !recipients.includes(project.owner_id)) {
            recipients.push(project.owner_id);
          }
        }
      }
      break;

    default:
      break;
  }

  // Remove duplicates and the actor (don't notify yourself)
  const unique = [...new Set(recipients)];
  if (eventType === "join_approved" || eventType === "join_rejected") {
    return unique;
  }
  return context.actorId ? unique.filter((id) => id !== context.actorId) : unique;
}

function extractMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_一-龥]+)/g;
  const matches: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    matches.push(match[1]);
  }
  return [...new Set(matches)];
}

// ==================== Channel Escalation ====================

export async function processChannelEscalation(): Promise<void> {
  const now = new Date();

  // Get all unread in-site notifications past email escalation threshold
  const prefs = await prisma.notificationPreference.findMany({
    where: {
      in_site_enabled: true,
      email_enabled: true,
    },
  });

  for (const pref of prefs) {
    const threshold = new Date(now.getTime() - pref.email_escalation_min * 60 * 1000);

    const unreadNotifications = await prisma.notification.findMany({
      where: {
        user_id: pref.user_id,
        status: NotificationStatus.unread,
        created_at: { lt: threshold },
        channels: { not: { contains: NotificationChannel.email } },
      },
      include: {
        user: {
          select: { email: true, qq_number: true },
        },
      },
    });

    for (const notification of unreadNotifications) {
      if (!notification.user.email) continue;

      try {
        await executeDelivery({
          notificationId: notification.id,
          channel: NotificationChannel.email,
          recipient: {
            userId: pref.user_id,
            email: notification.user.email,
          },
          payload: {
            subject: `[提醒] ${notification.title}`,
            body: notification.content || "",
            notificationType: notification.type,
          },
        });

        // Update channels list
        const channels = JSON.parse(notification.channels) as string[];
        channels.push(NotificationChannel.email);
        await prisma.notification.update({
          where: { id: notification.id },
          data: { channels: JSON.stringify(channels) },
        });
      } catch (error) {
        console.error(`[Escalation] Email escalation failed for ${notification.id}:`, error);
      }
    }
  }

  // Check unread email past threshold -> escalate to QQ
  const qqPrefs = await prisma.notificationPreference.findMany({
    where: {
      email_enabled: true,
      qq_enabled: true,
    },
  });

  for (const pref of qqPrefs) {
    const threshold = new Date(now.getTime() - pref.qq_escalation_min * 60 * 1000);

    const emailDeliveries = await prisma.notificationDelivery.findMany({
      where: {
        channel: NotificationChannel.email,
        status: DeliveryStatus.sent,
        sent_at: { lt: threshold },
        notification: {
          user_id: pref.user_id,
          status: NotificationStatus.unread,
        },
      },
      include: {
        notification: {
          include: {
            user: {
              select: { qq_number: true },
            },
          },
        },
      },
    });

    for (const delivery of emailDeliveries) {
      if (!delivery.notification.user.qq_number) continue;

      // Check if already escalated to QQ
      const existingQQ = await prisma.notificationDelivery.findFirst({
        where: {
          notification_id: delivery.notification_id,
          channel: NotificationChannel.qq,
        },
      });

      if (existingQQ) continue;

      try {
        await executeDelivery({
          notificationId: delivery.notification_id,
          channel: NotificationChannel.qq,
          recipient: {
            userId: pref.user_id,
            qqNumber: delivery.notification.user.qq_number,
          },
          payload: {
            subject: `[紧急提醒] ${delivery.notification.title}`,
            body: delivery.notification.content || "",
            notificationType: delivery.notification.type,
          },
        });
      } catch (error) {
        console.error(`[Escalation] QQ escalation failed for ${delivery.notification_id}:`, error);
      }
    }
  }
}

// ==================== Overdue Task Escalation ====================

export async function processOverdueEscalation(): Promise<void> {
  const now = new Date();

  // Find tasks that are past due and not yet marked overdue
  const overdueTasks = await prisma.task.findMany({
    where: {
      due_date: { lt: now },
      status: {
        notIn: ["completed", "overdue", "frozen"],
      },
    },
    include: {
      project: {
        select: { id: true, name: true },
      },
      assignee: {
        select: { id: true, username: true, email: true, qq_number: true },
      },
    },
  });

  for (const task of overdueTasks) {
    // Mark task as overdue
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "overdue" },
    });

    // Notify assignee
    if (task.assignee) {
      await createNotification(task.assignee.id, "task_overdue", {
        projectId: task.project_id,
        taskId: task.id,
        taskName: task.title,
        projectName: task.project.name,
      });
    }

    // Escalate to supervisors and admins
    const supervisors = await prisma.projectMember.findMany({
      where: {
        project_id: task.project_id,
        OR: [
          { is_lead: true },
          { role: "supervisor" },
        ],
      },
      include: {
        user: {
          select: { id: true, email: true, qq_number: true },
        },
      },
    });

    for (const sup of supervisors) {
      await createNotification(sup.user.id, "task_overdue", {
        projectId: task.project_id,
        taskId: task.id,
        taskName: task.title,
        projectName: task.project.name,
      });
    }

    // Also notify group admins and super_admins
    const admins = await prisma.user.findMany({
      where: {
        role: { in: ["super_admin", "group_admin"] },
        status: "active",
      },
      select: { id: true },
    });

    for (const admin of admins) {
      // Check if already notified as supervisor
      const alreadyNotified = supervisors.some((s) => s.user.id === admin.id);
      if (!alreadyNotified) {
        await createNotification(admin.id, "task_overdue", {
          projectId: task.project_id,
          taskId: task.id,
          taskName: task.title,
          projectName: task.project.name,
        });
      }
    }
  }
}

// ==================== Task Reassignment Notification ====================

export async function sendTaskReassignmentNotification(
  previousAssigneeId: string,
  taskId: string,
  taskName: string,
  projectId: string,
  projectName: string,
  newAssigneeName: string
) {
  return createNotification(previousAssigneeId, "task_reassigned", {
    projectId,
    taskId,
    taskName,
    projectName,
    actorName: newAssigneeName,
  });
}

// ==================== Preferences ====================

export async function getNotificationPreferences(userId: string) {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { user_id: userId },
  });

  if (!prefs) {
    return getOrCreateDefaultPreferences(userId);
  }

  return prefs;
}

async function getOrCreateDefaultPreferences(userId: string) {
  return prisma.notificationPreference.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
    },
    update: {},
  });
}

export async function updateNotificationPreferences(
  userId: string,
  data: UpdatePreferencesInput
) {
  const updateData: Record<string, unknown> = {};

  if (data.email_enabled !== undefined) updateData.email_enabled = data.email_enabled;
  if (data.qq_enabled !== undefined) updateData.qq_enabled = data.qq_enabled;
  if (data.in_site_enabled !== undefined) updateData.in_site_enabled = data.in_site_enabled;
  if (data.email_escalation_min !== undefined) updateData.email_escalation_min = data.email_escalation_min;
  if (data.qq_escalation_min !== undefined) updateData.qq_escalation_min = data.qq_escalation_min;
  if (data.task_assigned !== undefined) updateData.task_assigned = data.task_assigned;
  if (data.task_completed !== undefined) updateData.task_completed = data.task_completed;
  if (data.task_reassigned !== undefined) updateData.task_reassigned = data.task_reassigned;
  if (data.review_requested !== undefined) updateData.review_requested = data.review_requested;
  if (data.review_approved !== undefined) updateData.review_approved = data.review_approved;
  if (data.review_rejected !== undefined) updateData.review_rejected = data.review_rejected;
  if (data.join_approved !== undefined) updateData.join_approved = data.join_approved;
  if (data.file_uploaded !== undefined) updateData.file_uploaded = data.file_uploaded;
  if (data.mention !== undefined) updateData.mention = data.mention;
  if (data.task_overdue !== undefined) updateData.task_overdue = data.task_overdue;
  if (data.conflict_detected !== undefined) updateData.conflict_detected = data.conflict_detected;
  if (data.downstream_reset !== undefined) updateData.downstream_reset = data.downstream_reset;

  return prisma.notificationPreference.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      ...updateData,
    },
    update: updateData,
  });
}

// ==================== Batch Notification Creation ====================

export async function createBulkNotifications(
  userIds: string[],
  type: NotificationType,
  context: NotificationContext
) {
  const results = [];
  for (const userId of userIds) {
    try {
      const notification = await createNotification(userId, type, context);
      results.push({ userId, notificationId: notification.id, success: true });
    } catch (error) {
      results.push({ userId, success: false, error: String(error) });
    }
  }
  return results;
}

// ==================== Retry Failed Deliveries ====================

export async function retryFailedDeliveries(): Promise<void> {
  const failed = await prisma.notificationDelivery.findMany({
    where: {
      status: DeliveryStatus.failed,
      retry_count: { lt: 3 },
    },
    take: 50,
  });

  for (const delivery of failed) {
    try {
      await retryFailedDelivery(delivery.id);
    } catch (error) {
      console.error(`[NotificationService] Retry failed for ${delivery.id}:`, error);
    }
  }
}

// ==================== Legacy compatibility ====================

export async function createNotificationLegacy(data: CreateNotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      user_id: data.user_id,
      type: data.type,
      title: data.title,
      content: data.content,
      project_id: data.project_id,
      task_id: data.task_id,
      actor_id: data.actor_id,
      channels: JSON.stringify([NotificationChannel.in_site]),
    },
  });
  return notification;
}
