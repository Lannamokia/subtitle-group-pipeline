import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import type {
  TaskRole,
  TaskStatus,
  FileType,
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

export const TIMELINE_EVENT_MAP: Record<TimelineEventType, { label: string; color: string }> = {
  task_status: { label: "任务变更", color: "bg-blue-500" },
  file_upload: { label: "文件上传", color: "bg-green-500" },
  review: { label: "审核", color: "bg-emerald-500" },
  member_join: { label: "成员变动", color: "bg-purple-500" },
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
