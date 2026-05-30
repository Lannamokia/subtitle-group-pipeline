import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

function assertIncludes(name, haystack, needles) {
  const missing = needles.filter((needle) => !haystack.includes(needle));
  if (missing.length > 0) {
    throw new Error(`${name} missing: ${missing.join(", ")}`);
  }
}

function assertNotIncludes(name, haystack, needles) {
  const found = needles.filter((needle) => haystack.includes(needle));
  if (found.length > 0) {
    throw new Error(`${name} should not include: ${found.join(", ")}`);
  }
}

function assertMatches(name, haystack, patterns) {
  const missing = patterns.filter((pattern) => !pattern.test(haystack));
  if (missing.length > 0) {
    throw new Error(`${name} missing patterns: ${missing.map(String).join(", ")}`);
  }
}

const files = {
  api: await source("lib/api.ts"),
  app: await source("App.tsx"),
  login: await source("pages/LoginPage.tsx"),
  projectDetail: await source("pages/ProjectDetailPage.tsx"),
  taskWorkflow: await source("lib/taskWorkflow.ts"),
  fileList: await source("pages/FileListPage.tsx"),
  fileItem: await source("components/FileListItem.tsx"),
  dedup: await source("pages/DedupPage.tsx"),
  wiki: await source("pages/WikiPage.tsx"),
  archive: await source("pages/ArchivePage.tsx"),
  notifications: await source("pages/NotificationSettingsPage.tsx"),
  dashboard: await source("pages/DashboardPage.tsx"),
  personalTaskBoard: await source("components/PersonalTaskBoard.tsx"),
  profile: await source("pages/ProfilePage.tsx"),
  members: await source("pages/MemberPage.tsx"),
  passwordRuleHint: await source("components/PasswordRuleHint.tsx"),
  passwordPolicy: await source("lib/passwordPolicy.ts"),
  storage: await source("pages/admin/StorageBackendPage.tsx"),
  announcements: await source("pages/admin/AnnouncementAdminPage.tsx"),
  comments: await source("components/TaskCommentPanel.tsx"),
  workload: await source("pages/WorkloadPage.tsx"),
  retention: await source("pages/admin/DataRetentionPage.tsx"),
};

assertIncludes("pending verification UX", files.login, [
  "verification",
  "verifyCommand",
  "navigator.clipboard.writeText",
  "验证指令",
]);

assertIncludes("task workflow surface", files.projectDetail, [
  "taskApi.assignTask",
  "taskApi.claimTask",
  "taskApi.returnTask",
  "taskApi.submitTask",
  "taskApi.approveTask",
  "taskApi.rejectTask",
  "blockedDependencies",
  "TaskCommentPanel",
]);

assertIncludes("serial task workflow stepper", files.projectDetail + files.taskWorkflow + files.api, [
  "TASK_WORKFLOW_STEPS",
  "TASK_PIPELINE_ROLES",
  "TASK_DELIVERY_RULES",
  "workflowSummaries",
  "highlightedStepIndex",
  "rounded-full border-2",
  "right-1/2 top-1/2 h-0.5",
  "createDependency",
  "我的岗位操作面板",
  "串行制作流水线",
  "提交任务文件",
  "任务模板",
  "TASK_TEMPLATE_CUSTOM_VALUE",
  "getTaskWorkflowStep",
  "ProductOutputRequirement",
  "成品配置",
  "内封成品",
  "内嵌成品",
  "productConfig",
  ".webm",
  ".vtt",
  ".ttml",
]);

assertNotIncludes("task templates stay inside create dialog", files.projectDetail, [
  "openCreateTaskDialog(step.role",
  "step.templates.map((template)",
  "每一步都提供专属任务模板",
]);

assertIncludes("file bucket history and explicit replace", files.fileList, [
  "fileApi.getVersions",
  "fileApi.replaceFile",
  "uploadMode",
  "replaceTargetId",
  "tagFilter",
  "handleApproveVersion",
]);
assertIncludes("multi-version marker and context history", files.fileItem, [
  "file.versionCount > 1",
  "版本历史",
  "DropdownMenuItem",
]);

assertIncludes("dedup comparison and restricted conflict actions", files.dedup, [
  "leftVersion",
  "rightVersion",
  "versionOptions",
  "handleResolve",
  "isSupervisor",
  "bg-red",
]);

assertIncludes("project wiki editing and approval", files.wiki, [
  "MarkdownRenderer",
  "EditableTableBlock",
  "wikiApi.updateWiki",
  "wikiApi.createWiki",
  "wikiApi.approveWiki",
  "ApprovalFlowIndicator",
]);

assertIncludes("archive recycle and retention settings", files.archive + files.retention, [
  "projectApi.unarchiveProject",
  "projectApi.deleteProject",
  "projectApi.restoreProject",
  "include_deleted",
  "storageApi.getRetentionSettings",
  "storageApi.updateRetentionSettings",
]);

assertIncludes("search and filter surfaces", files.projectDetail + files.fileList, [
  "搜索任务",
  "搜索文件",
  "tagFilter",
  "typeFilter",
]);

assertIncludes("delivery checklist editing", files.projectDetail, [
  "DeliveryChecklistEditor",
  "deliveryChecklist",
  "projectApi.updateProject",
]);

assertIncludes("announcements", files.announcements + files.projectDetail + files.dashboard, [
  "announcementApi.getAnnouncements",
  "announcementApi.createAnnouncement",
  "announcementApi.updateAnnouncement",
  "announcementApi.deleteAnnouncement",
  "ProjectAnnouncementsTab",
  "latestGlobalAnnouncement",
]);

assertIncludes("activity timeline", files.projectDetail + files.dashboard, [
  "TimelineEventItem",
  "/timeline/project/",
  "timelineApi.getGlobalEvents",
]);

assertIncludes("notification delivery status", files.notifications + files.api, [
  "notificationApi.getPreferences",
  "notificationApi.updatePreferences",
  "notificationApi.getNotifications",
  "deliveries",
]);

assertIncludes("profile editing", files.profile, [
  "authApi.updateProfile",
  "storageApi.uploadAvatar",
  "AvatarImage",
  "nickname",
]);

assertIncludes("member password validation UX", files.members + files.login + files.passwordRuleHint + files.passwordPolicy + files.api, [
  "PasswordRuleHint",
  "validatePassword",
  "PASSWORD_RULE_MESSAGE",
  "密码强度规则",
  "8-128 个字符",
  "至少包含 1 个英文字母",
  "至少包含 1 个数字",
  "不能包含空格或换行",
  "VALIDATION_ERROR",
  "translateValidationMessage",
  "toast.error(PASSWORD_RULE_MESSAGE)",
]);

assertIncludes("storage backend configuration", files.storage, [
  "storageApi.getBackends",
  "storageApi.createBackend",
  "storageApi.updateBackend",
  "storageApi.deleteBackend",
  "quotaBytes",
]);

assertIncludes("personal task board on dashboard", files.dashboard + files.personalTaskBoard, [
  "PersonalTaskBoard",
  "我的任务看板",
  "task.assigneeId === user?.id",
]);

assertIncludes("workload dashboard", files.workload, [
  "SupervisorView",
  "AdminView",
  "taskApi.getTasks",
]);

assertIncludes("task comments with file reference", files.comments, [
  "taskApi.getComments",
  "taskApi.createComment",
  "fileApi.getVersions",
  "fileVersionId",
  "lineNumber",
  "ASS行号",
]);

assertMatches("routes expose required pages", files.app, [
  /path="\/projects\/:projectId\/dedup"/,
  /path="\/projects\/:projectId\/wiki"/,
  /path="\/archive"/,
  /path="\/workload"/,
  /path="\/admin\/settings"/,
]);

console.log("OpenSpec frontend requirement checks passed");
