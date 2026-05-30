import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import type {
  TaskRole,
  TaskStatus,
  FileType,
  TimelineEvent,
  TimelineEventType,
  UserRole,
} from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ========== Status/Role Mappings ==========

export const TASK_ROLE_MAP: Record<TaskRole, { label: string; color: string }> = {
  source: { label: "片源", color: "role-source" },
  timing: { label: "时轴", color: "role-timing" },
  translation: { label: "翻译", color: "role-translation" },
  post_production: { label: "后期", color: "role-post-production" },
  encoding: { label: "压制", color: "role-encoding" },
  release: { label: "发布", color: "role-release" },
  supervisor: { label: "监制", color: "role-supervisor" },
};

export const TASK_STATUS_MAP: Record<TaskStatus, { label: string; badgeClass: string; icon?: string }> = {
  pending_publish: { label: "待发布", badgeClass: "badge-neutral" },
  claimable: { label: "可领取", badgeClass: "badge-info" },
  assigned: { label: "已指派", badgeClass: "badge-translation" },
  in_progress: { label: "进行中", badgeClass: "badge-info" },
  submitted: { label: "已提交", badgeClass: "badge-warning" },
  review_approved: { label: "审核通过", badgeClass: "badge-success" },
  review_rejected: { label: "已驳回", badgeClass: "badge-danger" },
  completed: { label: "已完成", badgeClass: "badge-success" },
  overdue: { label: "超期", badgeClass: "badge-warning" },
  frozen: { label: "已冻结", badgeClass: "badge-neutral" },
};

export const FILE_TYPE_MAP: Record<FileType, { label: string; icon: string }> = {
  video: { label: "视频", icon: "Film" },
  subtitle: { label: "字幕", icon: "FileText" },
  font: { label: "字体", icon: "Type" },
  project_package: { label: "工程包", icon: "Archive" },
  other: { label: "其他", icon: "File" },
};

export const USER_ROLE_MAP: Record<UserRole, string> = {
  super_admin: "超级管理员",
  group_admin: "组管理员",
  supervisor: "监制",
  member: "成员",
};

export const TIMELINE_EVENT_MAP: Record<string, { label: string; color: string }> = {
  task_status: { label: "任务变更", color: "bg-blue-500" },
  task_created: { label: "任务创建", color: "bg-blue-500" },
  task_claimed: { label: "任务领取", color: "bg-blue-500" },
  task_assigned: { label: "任务指派", color: "bg-blue-500" },
  task_started: { label: "任务开始", color: "bg-blue-500" },
  task_submitted: { label: "任务提交", color: "bg-blue-500" },
  task_approved: { label: "任务通过", color: "bg-emerald-500" },
  task_rejected: { label: "任务驳回", color: "bg-red-500" },
  task_reset: { label: "任务重置", color: "bg-amber-500" },
  task_cancelled: { label: "任务取消", color: "bg-slate-500" },
  task_returned: { label: "任务退回", color: "bg-amber-500" },
  task_completed: { label: "任务完成", color: "bg-emerald-500" },
  task_overdue: { label: "任务超期", color: "bg-red-500" },
  task_frozen: { label: "任务冻结", color: "bg-slate-500" },
  file_upload: { label: "文件上传", color: "bg-green-500" },
  file_uploaded: { label: "文件上传", color: "bg-green-500" },
  review: { label: "审核", color: "bg-emerald-500" },
  review_submitted: { label: "审核提交", color: "bg-emerald-500" },
  review_approved: { label: "审核通过", color: "bg-emerald-500" },
  review_rejected: { label: "审核驳回", color: "bg-red-500" },
  member_join: { label: "成员变动", color: "bg-purple-500" },
  member_joined: { label: "成员加入", color: "bg-purple-500" },
  member_left: { label: "成员离开", color: "bg-purple-500" },
  member_added: { label: "成员添加", color: "bg-purple-500" },
  member_removed: { label: "成员移除", color: "bg-purple-500" },
  join_request_created: { label: "加入申请", color: "bg-purple-500" },
  join_request_approved: { label: "申请通过", color: "bg-purple-500" },
  join_request_rejected: { label: "申请拒绝", color: "bg-purple-500" },
  project_created: { label: "项目创建", color: "bg-sky-500" },
  project_started: { label: "项目开始", color: "bg-sky-500" },
  project_paused: { label: "项目暂停", color: "bg-amber-500" },
  project_resumed: { label: "项目恢复", color: "bg-sky-500" },
  project_completed: { label: "项目完成", color: "bg-emerald-500" },
  project_archived: { label: "项目归档", color: "bg-slate-500" },
  project_unarchived: { label: "取消归档", color: "bg-sky-500" },
  project_deleted: { label: "项目删除", color: "bg-red-500" },
  project_restored: { label: "项目恢复", color: "bg-sky-500" },
  conflict_detected: { label: "冲突发现", color: "bg-red-500" },
  conflict_resolved: { label: "冲突解决", color: "bg-emerald-500" },
  wiki_updated: { label: "Wiki更新", color: "bg-indigo-500" },
  wiki_approved: { label: "Wiki通过", color: "bg-emerald-500" },
  wiki_rejected: { label: "Wiki驳回", color: "bg-red-500" },
  announcement: { label: "公告", color: "bg-orange-500" },
  milestone_reached: { label: "里程碑", color: "bg-yellow-500" },
  custom: { label: "自定义", color: "bg-slate-500" },
  system: { label: "系统", color: "bg-slate-500" },
};

// ========== Formatters ==========

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + units[i];
}

export function formatRelativeTime(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhCN });
}

export function formatDate(date: string | Date, pattern = "yyyy-MM-dd HH:mm"): string {
  return format(new Date(date), pattern, { locale: zhCN });
}

export function formatFullDate(date: string | Date): string {
  return format(new Date(date), "yyyy年M月d日 EEEE", { locale: zhCN });
}

export function formatTimelineDescription(event: Pick<TimelineEvent, "type" | "description">): string {
  const description = event.description || TIMELINE_EVENT_MAP[event.type]?.label || "系统动态";
  const quoted = description.match(/"([^"]+)"/)?.[1];

  switch (event.type) {
    case "file_uploaded":
    case "file_upload":
      if (/^File ".+" was uploaded$/.test(description) && quoted) return `文件「${quoted}」已上传`;
      if (/^File ".+" received a new version$/.test(description) && quoted) return `文件「${quoted}」已上传新版本`;
      return description;
    case "project_created":
      if (/^Project ".+" was created$/.test(description) && quoted) return `项目「${quoted}」已创建`;
      if (/^Project ".+" was created from template ".+"$/.test(description)) {
        const matches = [...description.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
        if (matches.length >= 2) return `项目「${matches[0]}」已从模板「${matches[1]}」创建`;
      }
      return description;
    case "project_archived":
      if (/^Project ".+" was archived$/.test(description) && quoted) return `项目「${quoted}」已归档`;
      return description;
    case "project_restored":
      if (/^Project ".+" was restored from archive$/.test(description) && quoted) return `项目「${quoted}」已从归档恢复`;
      if (/^Project ".+" was restored from recycle bin$/.test(description) && quoted) return `项目「${quoted}」已从回收站恢复`;
      return description;
    case "project_deleted":
      if (/^Project ".+" was moved to recycle bin$/.test(description) && quoted) return `项目「${quoted}」已移入回收站`;
      return description;
    case "task_created":
      if (/^Task ".+" was created$/.test(description) && quoted) return `任务「${quoted}」已创建`;
      return description;
    case "task_claimed":
      if (/^Task ".+" was claimed$/.test(description) && quoted) return `任务「${quoted}」已领取`;
      return description;
    case "task_assigned":
      if (/^Task ".+" was assigned$/.test(description) && quoted) return `任务「${quoted}」已指派`;
      return description;
    case "task_started":
      if (/^Task ".+" is now in progress$/.test(description) && quoted) return `任务「${quoted}」已开始处理`;
      return description;
    case "task_submitted":
      if (/^Task ".+" was submitted/.test(description) && quoted) return `任务「${quoted}」已提交审核`;
      return description;
    case "task_approved":
      if (/^Task ".+" was approved$/.test(description) && quoted) return `任务「${quoted}」已通过审核`;
      return description;
    case "task_rejected":
      if (/^Task ".+" was rejected with review comments$/.test(description) && quoted) return `任务「${quoted}」已被驳回并附有审核意见`;
      return description;
    case "task_returned":
      if (/^Task ".+" was returned to the pool$/.test(description) && quoted) return `任务「${quoted}」已退回任务池`;
      return description;
    case "task_reset":
      if (/^Task ".+" was reset to in_progress/.test(description) && quoted) return `任务「${quoted}」已重置为进行中`;
      if (/^Task ".+" was reset because an upstream task was modified$/.test(description) && quoted) return `任务「${quoted}」因上游任务变更被重置`;
      return description;
    case "task_cancelled":
      if (/^Task ".+" was cancelled/.test(description) && quoted) return `任务「${quoted}」已取消`;
      return description;
    case "task_frozen":
      if (/^Task ".+" was frozen because an upstream task was cancelled$/.test(description) && quoted) return `任务「${quoted}」因上游任务取消被冻结`;
      return description;
    case "member_removed":
      return description.replace(" was removed from the project", " 已从项目中移除");
    case "join_request_created":
      return description.replace(/^A new join request was submitted for role (.+)$/, "新的加入申请已提交，申请角色：$1");
    case "join_request_approved":
      return description.replace(/^Join request for role (.+) was approved$/, "角色「$1」的加入申请已通过");
    case "join_request_rejected":
      return description.replace(/^Join request for role (.+) was rejected$/, "角色「$1」的加入申请已拒绝");
    case "wiki_updated":
      if (/^Wiki ".+" was updated/.test(description) && quoted) return `Wiki「${quoted}」已更新`;
      return description;
    case "wiki_approved":
      if (/^Wiki ".+" changes were approved$/.test(description) && quoted) return `Wiki「${quoted}」的变更已通过`;
      return description;
    case "wiki_rejected":
      if (/^Wiki ".+" changes were rejected/.test(description) && quoted) return `Wiki「${quoted}」的变更已驳回`;
      return description;
    default:
      return description;
  }
}

// ========== Color Helpers ==========

export function getTaskStatusColor(status: TaskStatus): string {
  return TASK_STATUS_MAP[status]?.badgeClass || "badge-neutral";
}

export function getRoleColor(role: TaskRole): string {
  return TASK_ROLE_MAP[role]?.color || "badge-neutral";
}

export function getRoleLabel(role: TaskRole): string {
  return TASK_ROLE_MAP[role]?.label || role;
}

export function getFileTypeLabel(type: FileType): string {
  return FILE_TYPE_MAP[type]?.label || type;
}
