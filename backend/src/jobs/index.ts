import { scheduler } from "./scheduler";
import { markOverdueTasks } from "./overdue.task";
import { cleanupArchivedProjects } from "./archive.cleanup";
import { cleanupRecycleBin } from "./recyclebin.cleanup";
import { processNotificationEscalation } from "./notification.escalation";
import { cleanupExpiredDownloadLinks } from "./download.cleanup";

/**
 * Register all background jobs with the scheduler.
 * Each job has a cron expression controlling its execution frequency.
 */
export function registerAllJobs(): void {
  // 9.1: Overdue Task Auto-Marking - every hour
  scheduler.register({
    name: "overdue-task-marker",
    cronExpression: "0 * * * *",
    job: markOverdueTasks,
  });

  // 9.2: Archive Retention Cleanup - daily at 3:00 AM
  scheduler.register({
    name: "archive-cleanup",
    cronExpression: "0 3 * * *",
    job: cleanupArchivedProjects,
  });

  // 9.3: Recycle Bin Physical Cleanup - daily at 4:00 AM
  scheduler.register({
    name: "recyclebin-cleanup",
    cronExpression: "0 4 * * *",
    job: cleanupRecycleBin,
  });

  // 9.4: Notification Channel Escalation - every 30 minutes
  scheduler.register({
    name: "notification-escalation",
    cronExpression: "*/30 * * * *",
    job: processNotificationEscalation,
  });

  // 9.5: Download Link Expiration Cleanup - every 30 seconds
  // node-cron supports per-second granularity with */30 * * * * *
  scheduler.register({
    name: "download-cleanup",
    cronExpression: "*/30 * * * * *",
    job: cleanupExpiredDownloadLinks,
  });
}

export { scheduler };
