import { NotificationType } from "@prisma/client";
import {
  createNotification,
  createBulkNotifications,
  resolveRecipients,
  sendTaskReassignmentNotification,
  type EventContext,
  type NotificationContext,
} from "./notification.service";

// ==================== Task Event Hooks ====================

export async function onTaskAssigned(
  taskId: string,
  assigneeId: string,
  actorId: string,
  taskName: string,
  projectId: string,
  projectName: string
) {
  await createNotification(assigneeId, "task_assigned", {
    projectId,
    taskId,
    actorId,
    taskName,
    projectName,
  });
}

export async function onTaskClaimed(
  taskId: string,
  claimerId: string,
  taskName: string,
  projectId: string,
  projectName: string
) {
  await createNotification(claimerId, "task_assigned", {
    projectId,
    taskId,
    actorId: claimerId,
    taskName,
    projectName,
  });
}

export async function onTaskCompleted(
  taskId: string,
  actorId: string,
  taskName: string,
  projectId: string,
  projectName: string
) {
  const recipients = await resolveRecipients("task_completed", {
    taskId,
    actorId,
  });

  await createBulkNotifications(recipients, "task_completed", {
    projectId,
    taskId,
    actorId,
    taskName,
    projectName,
  });
}

export async function onTaskReassigned(
  taskId: string,
  previousAssigneeId: string,
  newAssigneeId: string,
  taskName: string,
  projectId: string,
  projectName: string,
  newAssigneeName: string
) {
  // Notify previous assignee
  await sendTaskReassignmentNotification(
    previousAssigneeId,
    taskId,
    taskName,
    projectId,
    projectName,
    newAssigneeName
  );

  // Notify new assignee
  await createNotification(newAssigneeId, "task_assigned", {
    projectId,
    taskId,
    taskName,
    projectName,
  });
}

export async function onTaskCancelled(
  taskId: string,
  actorId: string,
  taskName: string,
  projectId: string,
  projectName: string
) {
  const recipients = await resolveRecipients("task_cancelled", { taskId, actorId });
  await createBulkNotifications(recipients, "task_cancelled", {
    projectId,
    taskId,
    actorId,
    taskName,
    projectName,
  });
}

export async function onTaskReset(
  taskId: string,
  actorId: string,
  taskName: string,
  projectId: string,
  projectName: string
) {
  const recipients = await resolveRecipients("task_reset", { taskId, actorId });
  await createBulkNotifications(recipients, "task_reset", {
    projectId,
    taskId,
    actorId,
    taskName,
    projectName,
  });
}

// ==================== Review Event Hooks ====================

export async function onReviewRequested(
  reviewId: string,
  taskId: string,
  requesterId: string,
  taskName: string,
  projectId: string,
  projectName: string
) {
  const recipients = await resolveRecipients("review_requested", { reviewId });
  await createBulkNotifications(recipients, "review_requested", {
    projectId,
    taskId,
    actorId: requesterId,
    taskName,
    projectName,
  });
}

export async function onReviewApproved(
  reviewId: string,
  taskId: string,
  reviewerId: string,
  taskName: string,
  projectId: string,
  projectName: string
) {
  const recipients = await resolveRecipients("review_approved", { reviewId });
  await createBulkNotifications(recipients, "review_approved", {
    projectId,
    taskId,
    actorId: reviewerId,
    taskName,
    projectName,
  });
}

export async function onReviewRejected(
  reviewId: string,
  taskId: string,
  reviewerId: string,
  taskName: string,
  projectId: string,
  projectName: string,
  reason?: string
) {
  const recipients = await resolveRecipients("review_rejected", { reviewId });
  await createBulkNotifications(recipients, "review_rejected", {
    projectId,
    taskId,
    actorId: reviewerId,
    taskName,
    projectName,
    reason,
  });
}

// ==================== Join Request Event Hooks ====================

export async function onJoinRequestSubmitted(
  joinRequestId: string,
  projectId: string,
  projectName: string,
  requesterId: string,
  requesterName: string
) {
  const recipients = await resolveRecipients("join_request", {
    projectId,
    actorId: requesterId,
  });
  await createBulkNotifications(recipients, "join_request", {
    projectId,
    actorId: requesterId,
    actorName: requesterName,
    projectName,
  });
}

export async function onJoinRequestApproved(
  joinRequestId: string,
  projectId: string,
  projectName: string,
  approverId: string
) {
  const recipients = await resolveRecipients("join_approved", { joinRequestId });
  await createBulkNotifications(recipients, "join_approved", {
    projectId,
    actorId: approverId,
    projectName,
  });
}

export async function onJoinRequestRejected(
  joinRequestId: string,
  projectId: string,
  projectName: string,
  rejecterId: string,
  reason?: string
) {
  const recipients = await resolveRecipients("join_rejected", { joinRequestId });
  await createBulkNotifications(recipients, "join_rejected", {
    projectId,
    actorId: rejecterId,
    projectName,
    reason,
  });
}

// ==================== File Event Hooks ====================

export async function onFileUploaded(
  fileId: string,
  projectId: string,
  projectName: string,
  uploaderId: string,
  uploaderName: string,
  fileName: string
) {
  const recipients = await resolveRecipients("file_uploaded", {
    projectId,
    actorId: uploaderId,
  });
  await createBulkNotifications(recipients, "file_uploaded", {
    projectId,
    actorId: uploaderId,
    actorName: uploaderName,
    fileName,
    projectName,
  });
}

// ==================== Merge Event Hooks ====================

export async function onMergeCompleted(
  projectId: string,
  projectName: string,
  actorId: string
) {
  const recipients = await resolveRecipients("project_update", { projectId, actorId });
  await createBulkNotifications(recipients, "project_update", {
    projectId,
    actorId,
    projectName,
  });
}

export async function onMergeConflictsDetected(
  projectId: string,
  projectName: string,
  actorId: string
) {
  const recipients = await resolveRecipients("conflict_detected", { projectId, actorId });
  await createBulkNotifications(recipients, "conflict_detected", {
    projectId,
    actorId,
    projectName,
  });
}

// ==================== Comment Event Hooks ====================

/**
 * Task comments ONLY trigger on @mentions (not regular comments)
 */
export async function onTaskComment(
  taskId: string,
  taskName: string,
  projectId: string,
  projectName: string,
  commenterId: string,
  commenterName: string,
  commentContent: string
) {
  // Only process if there are @mentions
  const recipients = await resolveRecipients("mention", {
    taskId,
    actorId: commenterId,
    commentContent,
  });

  if (recipients.length === 0) {
    return; // No mentions, no notification
  }

  await createBulkNotifications(recipients, "mention", {
    projectId,
    taskId,
    actorId: commenterId,
    actorName: commenterName,
    taskName,
    projectName,
    reason: commentContent,
  });
}

// ==================== Downstream Reset Hook ====================

export async function onDownstreamReset(
  taskId: string,
  taskName: string,
  projectId: string,
  projectName: string,
  upstreamTaskName: string
) {
  const recipients = await resolveRecipients("downstream_reset", { taskId });
  await createBulkNotifications(recipients, "downstream_reset", {
    projectId,
    taskId,
    taskName,
    projectName,
    reason: `前置任务 ${upstreamTaskName} 发生变更`,
  });
}
