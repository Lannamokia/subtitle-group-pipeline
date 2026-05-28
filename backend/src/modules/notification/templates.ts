import { NotificationType } from "@prisma/client";

export interface TemplateContext {
  taskName?: string;
  projectName?: string;
  username?: string;
  actorName?: string;
  fileName?: string;
  reason?: string;
  [key: string]: string | undefined;
}

const TEMPLATES: Record<NotificationType, (ctx: TemplateContext) => { title: string; content: string }> = {
  task_assigned: (ctx) => ({
    title: `你被指派了新任务：${ctx.taskName || "未知任务"}`,
    content: `你已被指派负责「${ctx.taskName || "未知任务"}」，请尽快开始处理。`,
  }),
  task_completed: (ctx) => ({
    title: `任务已完成：${ctx.taskName || "未知任务"}`,
    content: `任务「${ctx.taskName || "未知任务"}」已完成。`,
  }),
  task_reassigned: (ctx) => ({
    title: `任务已转交：${ctx.taskName || "未知任务"}`,
    content: `任务「${ctx.taskName || "未知任务"}」已转交给 ${ctx.actorName || "其他成员"}，你不再负责此任务。`,
  }),
  task_cancelled: (ctx) => ({
    title: `任务已取消：${ctx.taskName || "未知任务"}`,
    content: `任务「${ctx.taskName || "未知任务"}」已被取消。`,
  }),
  task_reset: (ctx) => ({
    title: `任务已重置：${ctx.taskName || "未知任务"}`,
    content: `任务「${ctx.taskName || "未知任务"}」已被重置，需要重新处理。`,
  }),
  review_requested: (ctx) => ({
    title: `等待审核：${ctx.taskName || "未知任务"}`,
    content: `「${ctx.taskName || "未知任务"}」已提交，等待审核。`,
  }),
  review_approved: (ctx) => ({
    title: `审核已通过：${ctx.taskName || "未知任务"}`,
    content: `「${ctx.taskName || "未知任务"}」审核已通过。`,
  }),
  review_rejected: (ctx) => ({
    title: `审核未通过：${ctx.taskName || "未知任务"}`,
    content: `「${ctx.taskName || "未知任务"}」审核未通过${ctx.reason ? `，原因：${ctx.reason}` : ""}。`,
  }),
  claim_expired: (ctx) => ({
    title: `认领已过期：${ctx.taskName || "未知任务"}`,
    content: `你在「${ctx.taskName || "未知任务"}」中的认领已过期。`,
  }),
  project_update: (ctx) => ({
    title: `项目更新：${ctx.projectName || "未知项目"}`,
    content: `项目「${ctx.projectName || "未知项目"}」有更新。`,
  }),
  mention: (ctx) => ({
    title: `${ctx.actorName || "有人"}提到了你`,
    content: `${ctx.actorName || "有人"}在「${ctx.taskName || "任务"}」中@了你：${ctx.reason || ""}`,
  }),
  system: (ctx) => ({
    title: ctx.taskName || "系统通知",
    content: ctx.reason || "",
  }),
  join_request: (ctx) => ({
    title: `加入申请：${ctx.projectName || "未知项目"}`,
    content: `${ctx.actorName || "有人"}申请加入「${ctx.projectName || "未知项目"}」。`,
  }),
  join_approved: (ctx) => ({
    title: `加入申请已通过：${ctx.projectName || "未知项目"}`,
    content: `你加入「${ctx.projectName || "未知项目"}」的申请已通过。`,
  }),
  join_rejected: (ctx) => ({
    title: `加入申请未通过：${ctx.projectName || "未知项目"}`,
    content: `你加入「${ctx.projectName || "未知项目"}」的申请未通过${ctx.reason ? `，原因：${ctx.reason}` : ""}。`,
  }),
  file_uploaded: (ctx) => ({
    title: `新文件上传：${ctx.fileName || "未知文件"}`,
    content: `${ctx.actorName || "有人"}上传了文件「${ctx.fileName || "未知文件"}」。`,
  }),
  conflict_detected: (ctx) => ({
    title: `检测到冲突：${ctx.projectName || "未知项目"}`,
    content: `项目「${ctx.projectName || "未知项目"}」检测到合并冲突，请及时处理。`,
  }),
  announcement: (ctx) => ({
    title: ctx.taskName || "新公告",
    content: ctx.reason || "",
  }),
  task_overdue: (ctx) => ({
    title: `任务已超期：${ctx.taskName || "未知任务"}`,
    content: `任务「${ctx.taskName || "未知任务"}」已超期，请尽快处理。`,
  }),
  downstream_reset: (ctx) => ({
    title: `下游任务需重置：${ctx.taskName || "未知任务"}`,
    content: `因前置任务变更，「${ctx.taskName || "未知任务"}」需要重新处理。`,
  }),
};

export function renderNotificationTemplate(
  type: NotificationType,
  context: TemplateContext
): { title: string; content: string } {
  const renderer = TEMPLATES[type];
  if (!renderer) {
    return {
      title: context.taskName || "通知",
      content: context.reason || "",
    };
  }
  return renderer(context);
}

export function getNotificationTypePreferenceKey(type: NotificationType): string {
  const mapping: Record<NotificationType, string> = {
    task_assigned: "task_assigned",
    task_completed: "task_completed",
    task_reassigned: "task_reassigned",
    task_cancelled: "task_reassigned",
    task_reset: "task_reassigned",
    review_requested: "review_requested",
    review_approved: "review_approved",
    review_rejected: "review_rejected",
    claim_expired: "task_overdue",
    project_update: "file_uploaded",
    mention: "mention",
    system: "task_overdue",
    join_request: "join_approved",
    join_approved: "join_approved",
    join_rejected: "join_approved",
    file_uploaded: "file_uploaded",
    conflict_detected: "conflict_detected",
    announcement: "task_overdue",
    task_overdue: "task_overdue",
    downstream_reset: "downstream_reset",
  };
  return mapping[type] || "task_assigned";
}
