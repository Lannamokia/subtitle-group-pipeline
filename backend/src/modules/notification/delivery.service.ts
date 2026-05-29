import { prisma } from "../../config/database";
import { NotificationChannel, DeliveryStatus, type NotificationType } from "@prisma/client";
import { sendEmail, type EmailPayload } from "./adapters/email.adapter";
import { sendGroupMessage, sendPrivateMessage } from "./adapters/qq.adapter";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 45000]; // exponential backoff in ms

export interface DeliveryAttempt {
  notificationId: string;
  channel: NotificationChannel;
  recipient: {
    userId: string;
    email?: string | null;
    qqNumber?: string | null;
  };
  payload: {
    subject: string;
    body: string;
    groupId?: string;
    notificationType?: NotificationType;
  };
}

export async function createDeliveryRecord(
  notificationId: string,
  channel: NotificationChannel
) {
  return prisma.notificationDelivery.create({
    data: {
      notification_id: notificationId,
      channel,
      status: DeliveryStatus.pending,
    },
  });
}

export async function updateDeliveryStatus(
  deliveryId: string,
  status: DeliveryStatus,
  options?: { externalId?: string; errorMessage?: string }
) {
  const data: Record<string, unknown> = { status };

  if (status === DeliveryStatus.sent) {
    data.sent_at = new Date();
    if (options?.externalId) data.external_id = options.externalId;
  }
  if (status === DeliveryStatus.delivered) {
    data.delivered_at = new Date();
  }
  if (status === DeliveryStatus.failed) {
    data.failed_at = new Date();
    if (options?.errorMessage) data.error_message = options.errorMessage;
  }

  return prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data,
  });
}

export async function incrementRetryCount(deliveryId: string) {
  return prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      retry_count: { increment: 1 },
    },
  });
}

export async function executeDelivery(attempt: DeliveryAttempt): Promise<DeliveryStatus> {
  const delivery = await createDeliveryRecord(attempt.notificationId, attempt.channel);

  try {
    let result: { success: boolean; messageId?: string; error?: string };

    switch (attempt.channel) {
      case NotificationChannel.email:
        if (!attempt.recipient.email) {
          throw new Error("User has no email address");
        }
        result = await sendEmail({
          to: attempt.recipient.email,
          subject: attempt.payload.subject,
          body: attempt.payload.body,
          notificationType: attempt.payload.notificationType,
        });
        break;

      case NotificationChannel.qq:
        if (!attempt.recipient.qqNumber) {
          throw new Error("User has no QQ number");
        }
        {
          const groupId = attempt.payload.groupId ||
            process.env.QQ_DEFAULT_GROUP_ID ||
            process.env.NONEBOT_QQ_GROUP_ID;
          const content = `${attempt.payload.subject}\n${attempt.payload.body}`;
          result = groupId
            ? await sendGroupMessage({
                groupId,
                content,
                atUsers: [attempt.recipient.qqNumber],
              })
            : await sendPrivateMessage({
                userId: attempt.recipient.qqNumber,
                content,
              });
        }
        break;

      case NotificationChannel.in_site:
      default:
        // In-site delivery is implicit (notification record itself)
        result = { success: true, messageId: `in-site-${delivery.id}` };
        break;
    }

    if (result.success) {
      await updateDeliveryStatus(delivery.id, DeliveryStatus.sent, {
        externalId: result.messageId,
      });
      return DeliveryStatus.sent;
    } else {
      throw new Error(result.error || "Delivery failed");
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await updateDeliveryStatus(delivery.id, DeliveryStatus.failed, {
      errorMessage: errMsg,
    });
    return DeliveryStatus.failed;
  }
}

export async function retryFailedDelivery(deliveryId: string): Promise<DeliveryStatus> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      notification: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              qq_number: true,
            },
          },
        },
      },
    },
  });

  if (!delivery) {
    throw new Error("Delivery record not found");
  }

  if (delivery.retry_count >= MAX_RETRIES) {
    return DeliveryStatus.failed;
  }

  await incrementRetryCount(deliveryId);

  const attempt: DeliveryAttempt = {
    notificationId: delivery.notification_id,
    channel: delivery.channel,
    recipient: {
      userId: delivery.notification.user.id,
      email: delivery.notification.user.email,
      qqNumber: delivery.notification.user.qq_number,
    },
    payload: {
      subject: delivery.notification.title,
      body: delivery.notification.content || "",
      notificationType: delivery.notification.type,
    },
  };

  // Wait before retry
  const delay = RETRY_DELAYS[Math.min(delivery.retry_count, RETRY_DELAYS.length - 1)];
  await new Promise((resolve) => setTimeout(resolve, delay));

  return executeDelivery(attempt);
}

export async function processPendingDeliveries(): Promise<void> {
  const pending = await prisma.notificationDelivery.findMany({
    where: {
      status: DeliveryStatus.pending,
      retry_count: { lt: MAX_RETRIES },
    },
    include: {
      notification: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              qq_number: true,
            },
          },
        },
      },
    },
    take: 100,
  });

  for (const delivery of pending) {
    const attempt: DeliveryAttempt = {
      notificationId: delivery.notification_id,
      channel: delivery.channel,
      recipient: {
        userId: delivery.notification.user.id,
        email: delivery.notification.user.email,
        qqNumber: delivery.notification.user.qq_number,
      },
      payload: {
        subject: delivery.notification.title,
        body: delivery.notification.content || "",
        notificationType: delivery.notification.type,
      },
    };

    await executeDelivery(attempt);
  }
}

export async function retryFailedDeliveries(): Promise<void> {
  const failed = await prisma.notificationDelivery.findMany({
    where: {
      status: DeliveryStatus.failed,
      retry_count: { lt: MAX_RETRIES },
    },
    take: 50,
  });

  for (const delivery of failed) {
    try {
      await retryFailedDelivery(delivery.id);
    } catch (error) {
      console.error(`[DeliveryService] Retry failed for ${delivery.id}:`, error);
    }
  }
}

export async function sendQQGroupNotification(
  groupId: string,
  content: string,
  atQQNumbers?: string[]
): Promise<DeliveryStatus> {
  try {
    const result = await sendGroupMessage({
      groupId,
      content,
      atUsers: atQQNumbers,
    });

    if (result.success) {
      return DeliveryStatus.sent;
    }
    return DeliveryStatus.failed;
  } catch (error) {
    console.error("[DeliveryService] QQ group send failed:", error);
    return DeliveryStatus.failed;
  }
}

export async function getDeliveryLogs(notificationId: string) {
  return prisma.notificationDelivery.findMany({
    where: { notification_id: notificationId },
    orderBy: { created_at: "desc" },
  });
}
