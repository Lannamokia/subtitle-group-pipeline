import { prisma } from "../config/database";
import { TimelineEventType, TaskStatus } from "@prisma/client";
import * as notificationService from "../modules/notification/notification.service";
import * as timelineService from "../modules/timeline/timeline.service";

/**
 * Job: Overdue Task Auto-Marking
 * Runs every hour to find active tasks past their deadline and mark them as overdue.
 * Sends escalation notifications to supervisors, admins, and assignees.
 * Creates timeline events for audit trail.
 */
export async function markOverdueTasks(): Promise<void> {
  const now = new Date();

  // Find tasks that are past due and not yet in a terminal state
  const overdueTasks = await prisma.task.findMany({
    where: {
      due_date: { lt: now },
      status: {
        notIn: [
          TaskStatus.completed,
          TaskStatus.overdue,
          TaskStatus.frozen,
          TaskStatus.review_approved,
        ],
      },
    },
    include: {
      project: {
        select: { id: true, name: true, deleted_at: true },
      },
      assignee: {
        select: { id: true, username: true, email: true, qq_number: true },
      },
    },
  });

  if (overdueTasks.length === 0) {
    console.log("[OverdueTaskJob] No overdue tasks found");
    return;
  }

  console.log(`[OverdueTaskJob] Found ${overdueTasks.length} overdue task(s)`);

  for (const task of overdueTasks) {
    // Skip tasks in deleted projects
    if (task.project.deleted_at) {
      continue;
    }

    try {
      // Mark task as overdue
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.overdue },
      });

      console.log(`[OverdueTaskJob] Marked task "${task.title}" as overdue`);

      // Create timeline event
      await timelineService.createTimelineEvent({
        project_id: task.project_id,
        event_type: TimelineEventType.task_overdue,
        title: "Task marked overdue",
        description: `Task "${task.title}" passed its deadline and was marked overdue`,
        metadata: { task_id: task.id, due_date: task.due_date?.toISOString() },
      });

      // Notify assignee
      if (task.assignee) {
        await notificationService.createNotification(task.assignee.id, "task_overdue", {
          projectId: task.project_id,
          taskId: task.id,
          taskName: task.title,
          projectName: task.project.name,
        });
      }

      // Notify project supervisors and leads
      const supervisors = await prisma.projectMember.findMany({
        where: {
          project_id: task.project_id,
          OR: [{ is_lead: true }, { role: "supervisor" }],
        },
        include: {
          user: {
            select: { id: true },
          },
        },
      });

      for (const sup of supervisors) {
        await notificationService.createNotification(sup.user.id, "task_overdue", {
          projectId: task.project_id,
          taskId: task.id,
          taskName: task.title,
          projectName: task.project.name,
        });
      }

      // Notify group admins and super_admins
      const admins = await prisma.user.findMany({
        where: {
          role: { in: ["super_admin", "group_admin"] },
          status: "active",
        },
        select: { id: true },
      });

      for (const admin of admins) {
        // Skip if already notified as supervisor
        const alreadyNotified = supervisors.some((s) => s.user.id === admin.id);
        if (!alreadyNotified) {
          await notificationService.createNotification(admin.id, "task_overdue", {
            projectId: task.project_id,
            taskId: task.id,
            taskName: task.title,
            projectName: task.project.name,
          });
        }
      }
    } catch (error) {
      console.error(`[OverdueTaskJob] Failed to process task ${task.id}:`, error);
      // Continue with next task - do not crash the scheduler
    }
  }

  console.log(`[OverdueTaskJob] Processed ${overdueTasks.length} overdue task(s)`);
}
