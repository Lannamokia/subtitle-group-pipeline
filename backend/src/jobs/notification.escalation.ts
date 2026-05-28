import { prisma } from "../config/database";
import { NotificationChannel, NotificationStatus, DeliveryStatus } from "@prisma/client";
import { executeDelivery } from "../modules/notification/delivery.service";

/**
 * Job: Notification Channel Escalation
 * Runs every 30 minutes to check unread in-site notifications past escalation threshold.
 * Upgrades to email if configured and unread.
 * Checks unread email past threshold and upgrades to QQ if configured and unread.
 */
export async function processNotificationEscalation(): Promise<void> {
  const now = new Date();

  // Phase 1: In-site -> Email escalation
  await escalateInSiteToEmail(now);

  // Phase 2: Email -> QQ escalation
  await escalateEmailToQQ(now);

  console.log("[NotificationEscalationJob] Escalation processing complete");
}

async function escalateInSiteToEmail(now: Date): Promise<void> {
  // Get users who have both in-site and email enabled
  const prefs = await prisma.notificationPreference.findMany({
    where: {
      in_site_enabled: true,
      email_enabled: true,
    },
  });

  if (prefs.length === 0) {
    return;
  }

  let escalatedCount = 0;

  for (const pref of prefs) {
    const thresholdMinutes = pref.email_escalation_min;
    const threshold = new Date(now.getTime() - thresholdMinutes * 60 * 1000);

    // Find unread in-site notifications past threshold that haven't been escalated to email
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
        // Deliver via email
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

        // Update channels list to include email
        const channels = JSON.parse(notification.channels) as string[];
        if (!channels.includes(NotificationChannel.email)) {
          channels.push(NotificationChannel.email);
          await prisma.notification.update({
            where: { id: notification.id },
            data: { channels: JSON.stringify(channels) },
          });
        }

        escalatedCount++;
      } catch (error) {
        console.error(`[NotificationEscalationJob] Email escalation failed for ${notification.id}:`, error);
        // Continue with next notification
      }
    }
  }

  if (escalatedCount > 0) {
    console.log(`[NotificationEscalationJob] Escalated ${escalatedCount} notification(s) in-site -> email`);
  }
}

async function escalateEmailToQQ(now: Date): Promise<void> {
  // Get users who have both email and QQ enabled
  const prefs = await prisma.notificationPreference.findMany({
    where: {
      email_enabled: true,
      qq_enabled: true,
    },
  });

  if (prefs.length === 0) {
    return;
  }

  let escalatedCount = 0;

  for (const pref of prefs) {
    const thresholdMinutes = pref.qq_escalation_min;
    const threshold = new Date(now.getTime() - thresholdMinutes * 60 * 1000);

    // Find email deliveries that were sent past threshold and are still unread
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
        // Deliver via QQ
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

        escalatedCount++;
      } catch (error) {
        console.error(`[NotificationEscalationJob] QQ escalation failed for ${delivery.notification_id}:`, error);
        // Continue with next delivery
      }
    }
  }

  if (escalatedCount > 0) {
    console.log(`[NotificationEscalationJob] Escalated ${escalatedCount} notification(s) email -> QQ`);
  }
}
