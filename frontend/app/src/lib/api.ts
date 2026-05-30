import axios, { AxiosError, type AxiosInstance } from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import type {
  User,
  LoginCredentials,
  RegisterData,
  LoginResponse,
  RegisterResponse,
  RegistrationSettings,
  RoleTagDefinition,
  RoleTagApplication,
  UserRoleTagStatus,
  StorageBackend,
  StorageBackendInput,
  Project,
  Task,
  TaskRole,
  TaskComment,
  FileEntity,
  FileVersion,
  LinkAsset,
  Notification,
  NotificationPreference,
  ProjectTemplate,
  TimelineEvent,
  SubtitleConflict,
  WikiDocument,
  Announcement,
  DataRetentionSettings,
  ApiResponse,
  PaginatedResponse,
} from '@/types';

// Create axios instance
export const api: AxiosInstance = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor: add JWT token
api.interceptors.request.use(
  (config) => {
    try {
      const storage = localStorage.getItem('auth-storage');
      if (storage) {
        const parsed = JSON.parse(storage);
        const token = parsed.state?.user?.token;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch {
      // ignore parse error
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 and errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      toast.error('登录已过期，请重新登录');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

type AnyRecord = Record<string, any>;

// Helper to extract data from response
export function extractData<T>(response: { data: ApiResponse<T> }): T {
  return response.data.data;
}

export function unwrapData<T>(response: { data: ApiResponse<T> }): T {
  return response.data.data;
}

export function unwrapItems<T>(value: unknown): T[] {
  const data = (value as { data?: unknown })?.data ?? value;
  if (Array.isArray(data)) return data as T[];
  const record = data as AnyRecord;
  if (Array.isArray(record?.items)) return record.items as T[];
  if (Array.isArray(record?.files)) return record.files as T[];
  if (Array.isArray(record?.links)) return record.links as T[];
  return [];
}

export function unwrapPaginated<T>(
  response: { data: ApiResponse<unknown> },
  normalize: (raw: AnyRecord) => T
): PaginatedResponse<T> {
  const items = unwrapItems<unknown>(response.data.data).map((item) =>
    normalize(item as AnyRecord)
  );
  const meta = (response.data.meta ?? {}) as AnyRecord;

  return {
    items,
    total: Number(meta.total ?? items.length),
    page: Number(meta.page ?? 1),
    pageSize: Number(meta.pageSize ?? items.length),
  };
}

export function normalizeUser(raw: AnyRecord): User {
  return {
    id: raw.id,
    username: raw.username,
    nickname: raw.nickname,
    qq: raw.qq ?? raw.qq_number,
    avatar: raw.avatar ?? raw.avatar_url,
    role: raw.role,
    status: raw.status,
    roleTags: Array.isArray(raw.roleTags)
      ? raw.roleTags.map((tag: AnyRecord) => normalizeRoleTag(tag))
      : Array.isArray(raw.role_tags)
        ? raw.role_tags.map((tag: AnyRecord) => normalizeRoleTag(tag))
        : undefined,
    token: raw.token,
    refreshToken: raw.refreshToken,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
  };
}

export function normalizeStorageBackend(raw: AnyRecord): StorageBackend {
  let config: AnyRecord = {};
  if (typeof raw.config === "string") {
    try {
      config = JSON.parse(raw.config);
    } catch {
      config = {};
    }
  } else if (raw.config && typeof raw.config === "object") {
    config = raw.config;
  }

  return {
    id: raw.id,
    name: raw.name,
    type: raw.type ?? raw.backend_type ?? "local",
    endpoint: raw.endpoint ?? config.endpoint ?? config.rootPath ?? config.root_path ?? "",
    bucket: raw.bucket ?? config.bucket,
    rootPath: raw.rootPath ?? raw.root_path ?? config.rootPath ?? config.root_path,
    region: raw.region ?? config.region,
    accessKey: raw.accessKey ?? raw.access_key ?? config.accessKeyId ?? config.accessKey ?? config.access_key,
    secretKey: raw.secretKey ?? raw.secret_key ?? config.secretAccessKey ?? config.secretKey ?? config.secret_key,
    quotaBytes: raw.quotaBytes ?? raw.quota_bytes ?? 0,
    usedBytes: raw.usedBytes ?? raw.used_bytes ?? 0,
    isDefault: raw.isDefault ?? raw.is_default ?? false,
    isEnabled: raw.isEnabled ?? raw.is_active ?? false,
    projectCount: raw.projectCount ?? raw._count?.projects ?? 0,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    updatedAt: raw.updatedAt ?? raw.updated_at ?? "",
  };
}

function toStorageBackendPayload(data: Partial<StorageBackendInput>) {
  const config: AnyRecord = data.type === "s3"
    ? {
        endpoint: data.endpoint,
        bucket: data.bucket,
        region: data.region,
        accessKeyId: data.accessKey,
        secretAccessKey: data.secretKey || undefined,
      }
    : {
        endpoint: data.endpoint,
        rootPath: data.rootPath,
        basePath: data.rootPath || data.endpoint,
      };

  return {
    name: data.name,
    backend_type: data.type,
    config: JSON.stringify(config),
    is_default: data.isDefault,
    is_active: data.isEnabled,
    quota_bytes: data.quotaBytes,
  };
}

export function normalizeTask(raw: AnyRecord): Task {
  return {
    id: raw.id,
    name: raw.name ?? raw.title,
    projectId: raw.projectId ?? raw.project_id,
    project: raw.project ? normalizeProject(raw.project) : undefined,
    unitId: raw.unitId ?? raw.unit_id,
    role: raw.role,
    status: raw.status,
    assigneeId: raw.assigneeId ?? raw.assignee_id,
    assignee: raw.assignee ? normalizeUser(raw.assignee) : undefined,
    deadline: raw.deadline ?? raw.due_date,
    description: raw.description,
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies.map((dep: AnyRecord) => dep.depends_on_id ?? dep.id ?? dep)
      : [],
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    updatedAt: raw.updatedAt ?? raw.updated_at ?? "",
    fileCount: raw.fileCount ?? raw._count?.files,
  };
}

export function normalizeFile(raw: AnyRecord): FileEntity {
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === "string"
      ? (() => {
          try {
            return JSON.parse(raw.tags);
          } catch {
            return [];
          }
        })()
      : [];

  return {
    id: raw.id,
    name: raw.name ?? raw.original_name ?? "未命名文件",
    type: raw.type ?? raw.file_type ?? "other",
    projectId: raw.projectId ?? raw.project_id,
    taskId: raw.taskId ?? raw.task_id,
    uploader: raw.uploader ? normalizeUser(raw.uploader) : normalizeUser({ id: raw.uploader_id, username: "Unknown", role: "member", status: "active" }),
    size: raw.size ?? raw.size_bytes ?? 0,
    hash: raw.hash ?? raw.checksum,
    storageType: raw.storageType ?? "local",
    isSensitive: raw.isSensitive ?? tags.includes("sensitive"),
    tags,
    currentVersionId: raw.currentVersionId ?? raw.current_version_id ?? raw.versions?.find?.((v: AnyRecord) => v.is_current)?.id,
    latestVersionId: raw.latestVersionId ?? raw.latest_version_id ?? raw.versions?.find?.((v: AnyRecord) => v.is_latest)?.id,
    latestApprovedVersionId: raw.latestApprovedVersionId ?? raw.latest_approved_version_id ?? raw.versions?.find?.((v: AnyRecord) => v.is_latest_approved)?.id,
    versionCount: raw.versionCount ?? raw.version_count ?? raw.versions?.length ?? 1,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    updatedAt: raw.updatedAt ?? raw.updated_at ?? raw.created_at ?? "",
  };
}

export function normalizeFileVersion(raw: AnyRecord): FileVersion {
  return {
    id: raw.id,
    fileId: raw.fileId ?? raw.file_id,
    versionNumber: raw.versionNumber ?? raw.version_number ?? 1,
    uploader: raw.uploader ? normalizeUser(raw.uploader) : undefined,
    size: raw.size ?? raw.size_bytes ?? 0,
    hash: raw.hash ?? raw.checksum,
    storagePath: raw.storagePath ?? raw.storage_path ?? "",
    isApproved: Boolean(raw.isApproved ?? raw.is_latest_approved ?? raw.approved_at),
    isCurrent: raw.isCurrent ?? raw.is_current,
    isLatest: raw.isLatest ?? raw.is_latest,
    isLatestApproved: raw.isLatestApproved ?? raw.is_latest_approved,
    changeSummary: raw.changeSummary ?? raw.change_summary,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
  };
}

export function normalizeLink(raw: AnyRecord): LinkAsset {
  return {
    id: raw.id,
    projectId: raw.projectId ?? raw.project_id,
    name: raw.name ?? raw.description ?? raw.link_type ?? "网盘链接",
    url: raw.url,
    extractCode: raw.extractCode ?? raw.extract_code,
    description: raw.description,
    createdBy: raw.createdBy ? normalizeUser(raw.createdBy) : normalizeUser({ id: raw.created_by, username: "Unknown", role: "member", status: "active" }),
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    updatedAt: raw.updatedAt ?? raw.updated_at ?? raw.created_at ?? "",
  };
}

function normalizeNotificationType(type: string): Notification["type"] {
  if (type.includes("review")) return "review";
  if (type.includes("file") || type.includes("conflict")) return "file";
  if (type.includes("mention")) return "mention";
  if (type.includes("task") || type.includes("assignment") || type.includes("overdue")) return "task";
  return "system";
}

export function normalizeNotification(raw: AnyRecord): Notification {
  const channels = Array.isArray(raw.channels)
    ? raw.channels
    : typeof raw.channels === "string"
      ? (() => {
          try {
            return JSON.parse(raw.channels);
          } catch {
            return [];
          }
        })()
      : [];

  return {
    id: raw.id,
    type: normalizeNotificationType(String(raw.type ?? "system")),
    title: raw.title ?? "",
    content: raw.content ?? "",
    isRead: (raw.isRead ?? raw.status === "read") === true,
    channels,
    deliveries: Array.isArray(raw.deliveries)
      ? raw.deliveries.map((delivery: AnyRecord) => ({
          id: delivery.id,
          channel: delivery.channel,
          status: delivery.status,
          sentAt: delivery.sentAt ?? delivery.sent_at,
        }))
      : [],
    relatedId: raw.task_id ?? raw.project_id,
    relatedType: raw.task_id ? "task" : raw.project_id ? "project" : undefined,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
  };
}

export function normalizeNotificationPreference(raw: AnyRecord): NotificationPreference {
  const subscribedTypes: Notification["type"][] = [];
  if (raw.task_assigned ?? true) subscribedTypes.push("task");
  if (raw.review_requested ?? true) subscribedTypes.push("review");
  if (raw.file_uploaded ?? true) subscribedTypes.push("file");
  if (raw.mention ?? true) subscribedTypes.push("mention");
  if (raw.task_overdue ?? true) subscribedTypes.push("system");

  return {
    inSite: raw.inSite ?? raw.in_site_enabled ?? true,
    email: raw.email ?? raw.email_enabled ?? true,
    qq: raw.qq ?? raw.qq_enabled ?? true,
    escalationEnabled: raw.escalationEnabled ?? true,
    escalationInterval: Math.max(1, Math.round((raw.email_escalation_min ?? 120) / 60)),
    subscribedTypes: Array.from(new Set(subscribedTypes)),
  };
}

function toNotificationPreferencePayload(data: Partial<NotificationPreference>) {
  return {
    in_site_enabled: data.inSite,
    email_enabled: data.email,
    qq_enabled: data.qq,
    email_escalation_min: data.escalationInterval ? data.escalationInterval * 60 : undefined,
    qq_escalation_min: data.escalationInterval ? data.escalationInterval * 120 : undefined,
    task_assigned: data.subscribedTypes?.includes("task"),
    task_completed: data.subscribedTypes?.includes("task"),
    task_reassigned: data.subscribedTypes?.includes("task"),
    review_requested: data.subscribedTypes?.includes("review"),
    review_approved: data.subscribedTypes?.includes("review"),
    review_rejected: data.subscribedTypes?.includes("review"),
    file_uploaded: data.subscribedTypes?.includes("file"),
    mention: data.subscribedTypes?.includes("mention"),
    task_overdue: data.subscribedTypes?.includes("system"),
  };
}

export function normalizeWiki(raw: AnyRecord): WikiDocument {
  const parseBlocks = (value: unknown): WikiDocument["blocks"] => {
    if (!value) return [];
    const rawContent = typeof value === "string" ? value : JSON.stringify(value);
    try {
      const parsed = JSON.parse(rawContent);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to markdown block.
    }
    return rawContent
      ? [{ id: `${raw.id || "wiki"}-markdown`, type: "markdown", content: rawContent }]
      : [];
  };

  const pending = raw.pendingContent ?? raw.pending_content ?? raw.pending_diff?.to;
  return {
    id: raw.id,
    projectId: raw.projectId ?? raw.project_id,
    title: raw.title ?? "项目Wiki",
    blocks: parseBlocks(raw.display_content || raw.content),
    status: raw.status ?? "draft",
    pendingContent: pending,
    displayContent: raw.display_content,
    pendingDiff: raw.pending_diff ?? null,
    approvalRequired: raw.approvalRequired ?? raw.approval_required ?? false,
    updatedBy: raw.updatedBy ? normalizeUser(raw.updatedBy) : raw.creator ? normalizeUser(raw.creator) : normalizeUser({ id: raw.created_by, username: "Unknown", role: "member", status: "active" }),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? "",
  };
}

export function normalizeTaskComment(raw: AnyRecord): TaskComment {
  const content = String(raw.content ?? "");
  const mentions = Array.from(content.matchAll(/@([A-Za-z0-9_-]+)/g)).map((match) => match[1]);
  return {
    id: raw.id,
    taskId: raw.taskId ?? raw.task_id,
    user: raw.user ? normalizeUser(raw.user) : normalizeUser({ id: raw.user_id, username: "Unknown", role: "member", status: "active" }),
    content,
    fileVersionId: raw.fileVersionId ?? raw.file_version_id,
    fileVersion: raw.file_version ? normalizeFileVersion(raw.file_version) : undefined,
    lineNumber: raw.lineNumber ?? raw.line_number,
    mentions,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
  };
}

export function normalizeDataRetentionSettings(raw: AnyRecord): DataRetentionSettings {
  return {
    id: raw.id,
    archiveCleanupDays: raw.archiveCleanupDays ?? raw.archive_retention_days ?? raw.auto_delete_days ?? 365,
    archiveRetentionDays: raw.archiveRetentionDays ?? raw.archive_retention_days,
    autoArchiveDays: raw.autoArchiveDays ?? raw.auto_archive_days,
    autoDeleteDays: raw.autoDeleteDays ?? raw.auto_delete_days,
    recycleBinDays: raw.recycleBinDays ?? raw.recycle_bin_days ?? 30,
    auditLogRetentionDays: raw.auditLogRetentionDays ?? raw.audit_log_retention_days,
    notificationRetentionDays: raw.notificationRetentionDays ?? raw.notification_retention_days,
    maxFileVersions: raw.maxFileVersions ?? raw.max_file_versions,
    downloadLinkTtl: raw.downloadLinkTtl ?? raw.download_link_ttl_seconds ?? 300,
    linkCleanupInterval: raw.linkCleanupInterval ?? 30,
    wikiApprovalRequired: raw.wikiApprovalRequired ?? raw.wiki_approval_required ?? false,
  };
}

export function normalizeAnnouncement(raw: AnyRecord): Announcement {
  return {
    id: raw.id,
    type: raw.type ?? "global",
    projectId: raw.projectId ?? raw.project_id,
    title: raw.title ?? "",
    content: raw.content ?? "",
    createdBy: raw.createdBy ? normalizeUser(raw.createdBy) : raw.creator ? normalizeUser(raw.creator) : normalizeUser({ id: raw.created_by, username: "Unknown", role: "member", status: "active" }),
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    expiresAt: raw.expiresAt ?? raw.expires_at,
  };
}

export function normalizeTimelineEvent(raw: AnyRecord): TimelineEvent {
  return {
    id: raw.id,
    type: raw.type ?? raw.event_type ?? "system",
    projectId: raw.projectId ?? raw.project_id,
    projectName: raw.projectName ?? raw.project?.name,
    description: raw.description ?? raw.title ?? "",
    user: raw.user ? normalizeUser(raw.user) : raw.actor ? normalizeUser(raw.actor) : undefined,
    createdAt: raw.createdAt ?? raw.created_at ?? raw.occurred_at ?? "",
  };
}

function toDataRetentionPayload(data: Partial<DataRetentionSettings>) {
  return {
    archive_retention_days: data.archiveCleanupDays ?? data.archiveRetentionDays,
    auto_archive_days: data.autoArchiveDays,
    auto_delete_days: data.autoDeleteDays,
    recycle_bin_days: data.recycleBinDays,
    audit_log_retention_days: data.auditLogRetentionDays,
    notification_retention_days: data.notificationRetentionDays,
    max_file_versions: data.maxFileVersions,
    download_link_ttl_seconds: data.downloadLinkTtl,
    wiki_approval_required: data.wikiApprovalRequired,
  };
}

function toProjectPayload(data: Partial<Project>) {
  return {
    name: data.name,
    status: data.status,
    current_season: data.season,
    delivery_checklist: data.deliveryChecklist,
    download_link_ttl_seconds: data.downloadLinkTtlSeconds,
    wiki_approval_required: data.wikiApprovalRequired,
  };
}

function toAnnouncementPayload(data: Partial<Announcement> & { isPinned?: boolean }) {
  return {
    type: data.type,
    project_id: data.projectId,
    title: data.title,
    content: data.content,
    expires_at: data.expiresAt,
    is_pinned: data.isPinned,
  };
}

export function normalizeConflict(raw: AnyRecord): SubtitleConflict {
  let affected: number[] = [];
  if (typeof raw.affected_lines === "string") {
    try {
      affected = JSON.parse(raw.affected_lines);
    } catch {
      affected = [];
    }
  }

  const description = String(raw.description ?? "");
  const [, left = "", right = ""] = description.match(/^[^:]+:\s*(.*)\s+vs\s+(.*)$/) ?? [];
  const conflictType =
    raw.conflictType ??
    (raw.conflict_type === "content_mismatch"
      ? "text_conflict"
      : raw.conflict_type === "duplicate_entry"
        ? "exact_duplicate"
        : "overlap");
  const status =
    raw.resolution === "unresolved"
      ? "pending"
      : raw.resolution === "ignored"
        ? "deferred"
        : "resolved";

  return {
    id: raw.id,
    mergeJobId: raw.mergeJobId ?? raw.merge_job_id ?? "",
    startTime: affected[0] ?? raw.startTime ?? raw.start_time ?? 0,
    endTime: affected[1] ?? raw.endTime ?? raw.end_time ?? affected[0] ?? 0,
    conflictType,
    translations: raw.translations ?? [
      {
        translatorId: raw.file_a_id ?? "file_a",
        translatorName: "版本 A",
        text: left || description,
        style: "",
      },
      {
        translatorId: raw.file_b_id ?? "file_b",
        translatorName: "版本 B",
        text: right || "",
        style: "",
      },
    ],
    resolution: {
      status,
      mergedText: raw.resolution_note ?? undefined,
    },
  };
}

function normalizeRoleTag(raw: AnyRecord): RoleTagDefinition {
  const knownRoles = ["source", "timing", "translation", "post_production", "encoding", "release", "supervisor"];
  return {
    id: raw.id,
    name: raw.name,
    roleType: knownRoles.includes(raw.roleType ?? raw.name) ? (raw.roleType ?? raw.name) : "translation",
    description: raw.description,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
  };
}

function normalizeRoleTagApplication(raw: AnyRecord): RoleTagApplication {
  const reviewed = Boolean(raw.approved_by || raw.approved_at);
  return {
    id: raw.id,
    userId: raw.userId ?? raw.user_id,
    user: raw.user ? normalizeUser(raw.user) : normalizeUser({ id: raw.user_id, username: "Unknown", role: "member", status: "active" }),
    tagId: raw.tagId ?? raw.tag_id,
    tag: normalizeRoleTag(raw.tag ?? {}),
    reason: raw.reason ?? "",
    status: raw.approved ? "approved" : reviewed ? "rejected" : "pending",
    reviewedBy: raw.reviewer ? normalizeUser(raw.reviewer) : undefined,
    reviewComment: raw.reviewComment ?? raw.rejection_reason,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    updatedAt: raw.updatedAt ?? raw.updated_at ?? raw.created_at ?? "",
  };
}

export function normalizeProject(raw: AnyRecord): Project {
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [];
  const completed = tasks.filter((task) => ["completed", "review_approved"].includes(task.status)).length;
  const taskCount = tasks.length || raw._count?.tasks || 0;

  return {
    id: raw.id,
    name: raw.name,
    type: raw.type ?? raw.project_type ?? "anime",
    status: raw.status,
    season: raw.season ?? raw.current_season ?? 1,
    episodes: raw.episodes ?? raw._count?.units ?? raw.units?.length ?? 0,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    supervisorId: raw.supervisorId ?? raw.owner_id,
    supervisor: raw.supervisor ? normalizeUser(raw.supervisor) : raw.owner ? normalizeUser(raw.owner) : normalizeUser({ id: raw.owner_id, username: "Unknown", role: "supervisor", status: "active" }),
    members: Array.isArray(raw.members)
      ? raw.members.map((member: AnyRecord) => ({
          user: normalizeUser(member.user ?? member),
          role: member.role,
          joinedAt: member.joinedAt ?? member.joined_at ?? "",
        }))
      : [],
    progress: raw.progress ?? (taskCount > 0 ? Math.round((completed / taskCount) * 100) : 0),
    archivedAt: raw.archivedAt ?? raw.archived_at,
    deletedAt: raw.deletedAt ?? raw.deleted_at,
    deliveryChecklist: typeof raw.delivery_checklist === "string"
      ? (() => {
          try {
            return JSON.parse(raw.delivery_checklist);
          } catch {
            return [];
          }
        })()
      : raw.deliveryChecklist ?? raw.delivery_checklist ?? [],
    downloadLinkTtlSeconds: raw.downloadLinkTtlSeconds ?? raw.download_link_ttl_seconds,
    wikiApprovalRequired: raw.wikiApprovalRequired ?? raw.wiki_approval_required,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    updatedAt: raw.updatedAt ?? raw.updated_at ?? "",
  };
}

// Helper for error messages
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.message || error.response?.data?.message || error.message || '请求失败';
  }
  return '未知错误';
}

// ========== Auth API ==========

export const authApi = {
  login: (credentials: LoginCredentials) =>
    api.post<ApiResponse<LoginResponse>>('/auth/login', credentials).then(extractData),

  register: (data: RegisterData) =>
    api.post<ApiResponse<RegisterResponse>>('/auth/register', {
      username: data.username,
      password: data.password,
      qq_number: data.qq,
      tags: data.tags,
    }).then(extractData),

  logout: () =>
    api.post<ApiResponse<void>>('/auth/logout').then(extractData),

  me: () =>
    api.get<ApiResponse<unknown>>('/auth/me').then((response) =>
      normalizeUser(response.data.data as AnyRecord)
    ),

  updateProfile: (data: { nickname?: string; avatar?: string; avatarUrl?: string; email?: string }) =>
    api.put<ApiResponse<unknown>>('/auth/profile', {
      nickname: data.nickname,
      email: data.email,
      avatar_url: data.avatarUrl ?? data.avatar,
    }).then((response) => normalizeUser(response.data.data as AnyRecord)),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post<ApiResponse<void>>('/auth/change-password', data).then(extractData),

  getRegistrationPolicy: () =>
    api.get<ApiResponse<RegistrationSettings>>('/auth/registration-policy').then(extractData),

  updateRegistrationPolicy: (data: RegistrationSettings) =>
    api.put<ApiResponse<RegistrationSettings>>('/auth/registration-policy', data).then(extractData),

  refreshToken: () => {
    const storage = localStorage.getItem('auth-storage');
    const parsed = storage ? JSON.parse(storage) : null;
    const refreshToken = parsed?.state?.user?.refreshToken;
    return api.post<ApiResponse<{ token: string; refreshToken: string }>>('/auth/refresh', { refreshToken }).then(extractData);
  },
};

// ========== Role Tag API ==========

export const roleTagApi = {
  getAllTags: () =>
    api.get<ApiResponse<unknown[]>>('/auth/role-tags').then((response) =>
      response.data.data.map((tag) => normalizeRoleTag(tag as AnyRecord))
    ),

  createTag: (data: { name: string; roleType: string; description?: string }) =>
    api.post<ApiResponse<RoleTagDefinition>>('/auth/role-tags', data).then(extractData),

  updateTag: (id: string, data: { name?: string; roleType?: string; description?: string }) =>
    api.put<ApiResponse<RoleTagDefinition>>(`/auth/role-tags/${id}`, data).then(extractData),

  deleteTag: (id: string) =>
    api.delete<ApiResponse<void>>(`/auth/role-tags/${id}`).then(extractData),

  getMyTagStatuses: () =>
    api.get<ApiResponse<UserRoleTagStatus[]>>('/auth/role-tags/my-status').then(extractData),

  applyForTag: (tagId: string, reason: string) =>
    api.post<ApiResponse<RoleTagApplication>>('/auth/tag-applications', { tag_id: tagId, reason }).then(extractData),

  getApplications: (params?: { status?: string; page?: number; pageSize?: number }) => {
    const url = params?.status === 'pending' ? '/auth/tag-applications/pending' : '/auth/tag-applications/my';
    return api.get<ApiResponse<unknown[]>>(url, { params }).then((response) =>
      response.data.data.map((application) => normalizeRoleTagApplication(application as AnyRecord))
    );
  },

  reviewApplication: (id: string, data: { status: 'approved' | 'rejected'; comment?: string }) =>
    api.post<ApiResponse<RoleTagApplication>>('/auth/tag-applications/review', {
      application_id: id,
      approved: data.status === 'approved',
      rejection_reason: data.status === 'rejected' ? data.comment : undefined,
    }).then(extractData),
};

// ========== Storage API ==========

export const storageApi = {
  getBackends: () =>
    api.get<ApiResponse<unknown[]>>('/storage/backends').then((response) =>
      response.data.data.map((backend) => normalizeStorageBackend(backend as AnyRecord))
    ),

  getBackend: (id: string) =>
    api.get<ApiResponse<StorageBackend>>(`/storage/backends/${id}`).then(extractData),

  createBackend: (data: StorageBackendInput) =>
    api.post<ApiResponse<StorageBackend>>('/storage/backends', toStorageBackendPayload(data)).then(extractData),

  updateBackend: (id: string, data: Partial<StorageBackendInput>) =>
    api.put<ApiResponse<StorageBackend>>(`/storage/backends/${id}`, toStorageBackendPayload(data)).then(extractData),

  deleteBackend: (id: string) =>
    api.delete<ApiResponse<void>>(`/storage/backends/${id}`).then(extractData),

  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<ApiResponse<{ url: string }>>('/storage/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(extractData);
  },

  getStats: () =>
    api.get<ApiResponse<{ totalQuota: number; totalUsed: number; backendCount: number }>>('/storage/stats').then(extractData),

  getRetentionSettings: () =>
    api.get<ApiResponse<unknown>>('/storage/retention').then((response) =>
      normalizeDataRetentionSettings(response.data.data as AnyRecord)
    ),

  updateRetentionSettings: (data: Partial<DataRetentionSettings>) =>
    api.put<ApiResponse<unknown>>('/storage/retention', toDataRetentionPayload(data)).then((response) =>
      normalizeDataRetentionSettings(response.data.data as AnyRecord)
    ),
};

// ========== Project API ==========

export const projectApi = {
  getProjects: (params?: {
    status?: string;
    page?: number;
    pageSize?: number;
    include_archived?: boolean | string;
    include_deleted?: boolean | string;
    search?: string;
  }) =>
    api.get<ApiResponse<unknown[]>>('/projects', { params }).then((response) =>
      unwrapPaginated(response, normalizeProject)
    ),

  getProject: (id: string) =>
    api.get<ApiResponse<unknown>>(`/projects/${id}`).then((response) =>
      normalizeProject(response.data.data as AnyRecord)
    ),

  createProject: (data: Partial<Project>) =>
    api.post<ApiResponse<unknown>>('/projects', data).then((response) =>
      normalizeProject(response.data.data as AnyRecord)
    ),

  updateProject: (id: string, data: Partial<Project>) =>
    api.put<ApiResponse<unknown>>(`/projects/${id}`, toProjectPayload(data)).then((response) =>
      normalizeProject(response.data.data as AnyRecord)
    ),

  archiveProject: (id: string) =>
    api.post<ApiResponse<unknown>>(`/projects/${id}/archive`).then((response) =>
      normalizeProject(response.data.data as AnyRecord)
    ),

  unarchiveProject: (id: string) =>
    api.post<ApiResponse<unknown>>(`/projects/${id}/unarchive`).then((response) =>
      normalizeProject(response.data.data as AnyRecord)
    ),

  restoreProject: (id: string) =>
    api.post<ApiResponse<unknown>>(`/projects/${id}/restore`).then((response) =>
      normalizeProject(response.data.data as AnyRecord)
    ),

  deleteProject: (id: string) =>
    api.delete<ApiResponse<void>>(`/projects/${id}`).then(extractData),

  addMember: (projectId: string, data: { userId: string; role: TaskRole; isLead?: boolean }) =>
    api.post<ApiResponse<unknown>>(`/projects/${projectId}/members`, {
      user_id: data.userId,
      role: data.role,
      is_lead: data.isLead ?? false,
    }).then((response) => {
      const raw = response.data.data as AnyRecord;
      return {
        user: normalizeUser(raw.user ?? raw),
        role: raw.role as TaskRole,
        joinedAt: raw.joinedAt ?? raw.joined_at ?? "",
      };
    }),
};

// ========== Task API ==========

export const taskApi = {
  getTasks: (params?: { projectId?: string; status?: string; assigneeId?: string }) =>
    api.get<ApiResponse<unknown[]>>('/tasks', { params }).then((response) =>
      unwrapItems<unknown>(response.data.data).map((task) =>
        normalizeTask(task as AnyRecord)
      )
    ),

  getTask: (id: string) =>
    api.get<ApiResponse<unknown>>(`/tasks/${id}`).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  createTask: (data: Partial<Task>) =>
    api.post<ApiResponse<unknown>>('/tasks', data).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  updateTask: (id: string, data: Partial<Task>) =>
    api.put<ApiResponse<unknown>>(`/tasks/${id}`, data).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  claimTask: (id: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/claim`).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  assignTask: (id: string, assigneeId: string, overrideReason?: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/assign`, {
      assignee_id: assigneeId,
      override_reason: overrideReason || undefined,
    }).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  returnTask: (id: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/return`).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  startTask: (id: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/start`).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  submitTask: (id: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/submit`).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  approveTask: (id: string, comments?: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/approve`, { approved: true, comments }).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  rejectTask: (id: string, comments?: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/reject`, { approved: false, comments }).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  getComments: (taskId: string) =>
    api.get<ApiResponse<unknown[]>>(`/tasks/${taskId}/comments`).then((response) =>
      response.data.data.map((comment) => normalizeTaskComment(comment as AnyRecord))
    ),

  createComment: (taskId: string, data: { content: string; fileVersionId?: string; lineNumber?: number }) =>
    api.post<ApiResponse<unknown>>(`/tasks/${taskId}/comments`, {
      content: data.content,
      file_version_id: data.fileVersionId || undefined,
      line_number: data.lineNumber || undefined,
    }).then((response) => normalizeTaskComment(response.data.data as AnyRecord)),
};

// ========== File API ==========

export const fileApi = {
  getFiles: (params?: { projectId?: string; taskId?: string; type?: string; search?: string; tag?: string }) =>
    api.get<ApiResponse<unknown>>('/files', { params }).then((response) =>
      unwrapPaginated(response, normalizeFile)
    ),

  getFile: (id: string) =>
    api.get<ApiResponse<unknown>>(`/files/${id}`).then((response) =>
      normalizeFile(response.data.data as AnyRecord)
    ),

  uploadFile: (file: File, data: { projectId: string; taskId?: string; type?: string; tags?: string[]; changeSummary?: string }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', data.projectId);
    if (data.taskId) formData.append('taskId', data.taskId);
    if (data.type) formData.append('type', data.type);
    if (data.tags?.length) formData.append('tags', JSON.stringify(data.tags));
    if (data.changeSummary) formData.append('change_summary', data.changeSummary);
    return api.post<ApiResponse<unknown>>('/files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((response) => normalizeFile(response.data.data as AnyRecord));
  },

  replaceFile: (fileId: string, file: File, data?: { changeSummary?: string; tags?: string[] }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (data?.changeSummary) formData.append('change_summary', data.changeSummary);
    if (data?.tags?.length) formData.append('tags', JSON.stringify(data.tags));
    return api.post<ApiResponse<unknown>>(`/files/${fileId}/replace`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((response) => normalizeFile(response.data.data as AnyRecord));
  },

  getVersions: (fileId: string) =>
    api.get<ApiResponse<unknown[]>>(`/files/${fileId}/versions`).then((response) =>
      response.data.data.map((version) => normalizeFileVersion(version as AnyRecord))
    ),

  approveVersion: (fileId: string, versionId: string) =>
    api.post<ApiResponse<unknown>>(`/files/${fileId}/versions/${versionId}/approve`).then((response) =>
      normalizeFileVersion(response.data.data as AnyRecord)
    ),

  getLinks: (params?: { projectId?: string }) =>
    api.get<ApiResponse<unknown[]>>('/files/links', { params }).then((response) =>
      response.data.data.map((link) => normalizeLink(link as AnyRecord))
    ),

  createLink: (data: { projectId: string; name?: string; url: string; extractCode?: string; description?: string }) =>
    api.post<ApiResponse<unknown>>('/files/links', {
      projectId: data.projectId,
      name: data.name,
      url: data.url,
      extractCode: data.extractCode,
      description: data.description,
      link_type: "cloud_drive",
    }).then((response) => normalizeLink(response.data.data as AnyRecord)),

  deleteLink: (id: string) =>
    api.delete<ApiResponse<void>>(`/files/links/${id}`).then(extractData),

  deleteFile: (id: string) =>
    api.delete<ApiResponse<void>>(`/files/${id}`).then(extractData),
};

// ========== Notification API ==========

export const notificationApi = {
  getNotifications: (params?: { isRead?: boolean; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<unknown>>('/notifications', { params }).then((response) => {
      const data = response.data.data as AnyRecord;
      const notifications = Array.isArray(data?.notifications) ? data.notifications : unwrapItems<unknown>(data);
      return {
        items: notifications.map((notification) => normalizeNotification(notification as AnyRecord)),
        total: Number(response.data.meta?.total ?? notifications.length),
        page: Number(response.data.meta?.page ?? params?.page ?? 1),
        pageSize: Number(response.data.meta?.pageSize ?? params?.pageSize ?? notifications.length),
        unreadCount: Number(data?.unreadCount ?? 0),
      };
    }),

  markAsRead: (id: string) =>
    api.post<ApiResponse<void>>(`/notifications/${id}/read`).then(extractData),

  markAllAsRead: () =>
    api.post<ApiResponse<void>>('/notifications/read-all').then(extractData),

  dismissNotification: (id: string) =>
    api.delete<ApiResponse<void>>(`/notifications/${id}`).then(extractData),

  getUnreadCount: () =>
    api.get<ApiResponse<{ count: number }>>('/notifications/unread-count').then(extractData),

  getPreferences: () =>
    api.get<ApiResponse<unknown>>('/notifications/preferences').then((response) =>
      normalizeNotificationPreference(response.data.data as AnyRecord)
    ),

  updatePreferences: (data: Partial<NotificationPreference>) =>
    api.put<ApiResponse<unknown>>('/notifications/preferences', toNotificationPreferencePayload(data)).then((response) =>
      normalizeNotificationPreference(response.data.data as AnyRecord)
    ),
};

// ========== Template API ==========

export const templateApi = {
  getTemplates: () =>
    api.get<ApiResponse<ProjectTemplate[]>>('/templates').then(extractData),

  getTemplate: (id: string) =>
    api.get<ApiResponse<ProjectTemplate>>(`/templates/${id}`).then(extractData),

  createTemplate: (data: Partial<ProjectTemplate>) =>
    api.post<ApiResponse<ProjectTemplate>>('/templates', data).then(extractData),

  updateTemplate: (id: string, data: Partial<ProjectTemplate>) =>
    api.put<ApiResponse<ProjectTemplate>>(`/templates/${id}`, data).then(extractData),

  deleteTemplate: (id: string) =>
    api.delete<ApiResponse<void>>(`/templates/${id}`).then(extractData),
};

// ========== Timeline API ==========

export const timelineApi = {
  getEvents: (params?: { projectId?: string; limit?: number }) =>
    api.get<ApiResponse<{ events: unknown[] }>>(
      params?.projectId ? `/timeline/project/${params.projectId}` : '/timeline',
      { params: params?.limit ? { pageSize: params.limit } : undefined }
    ).then((response) =>
      (response.data.data.events ?? []).map((event) => normalizeTimelineEvent(event as AnyRecord))
    ),

  getGlobalEvents: () =>
    api.get<ApiResponse<{ events: unknown[] }>>('/timeline/global').then((response) => ({
      events: (response.data.data.events ?? []).map((event) => normalizeTimelineEvent(event as AnyRecord)),
    })),
};

// ========== Wiki API ==========

export const wikiApi = {
  getWiki: (projectId: string) =>
    api.get<ApiResponse<unknown>>(`/wiki/${projectId}`).then((response) =>
      normalizeWiki(response.data.data as AnyRecord)
    ),

  createWiki: (data: { projectId: string; title: string; blocks: WikiDocument["blocks"]; status?: string }) =>
    api.post<ApiResponse<unknown>>('/wiki', {
      project_id: data.projectId,
      title: data.title,
      slug: `project-${data.projectId.slice(0, 8)}`,
      content: JSON.stringify(data.blocks),
      status: data.status ?? "draft",
    }).then((response) => normalizeWiki(response.data.data as AnyRecord)),

  updateWiki: (id: string, data: { title?: string; blocks?: WikiDocument["blocks"]; status?: string }) =>
    api.put<ApiResponse<unknown>>(`/wiki/${id}`, {
      title: data.title,
      content: data.blocks ? JSON.stringify(data.blocks) : undefined,
      status: data.status,
    }).then((response) => normalizeWiki(response.data.data as AnyRecord)),

  approveWiki: (id: string, approved: boolean, reason?: string) =>
    api.post<ApiResponse<unknown>>(
      `/wiki/${id}/${approved ? "approve" : "reject"}`,
      approved ? { approved: true } : { reason }
    ).then((response) => {
      const raw = response.data.data as AnyRecord;
      return normalizeWiki((raw.wiki ?? raw) as AnyRecord);
    }),
};

// ========== Announcement API ==========

export const announcementApi = {
  getAnnouncements: (params?: { type?: string; projectId?: string }) =>
    api.get<ApiResponse<{ announcements: Announcement[] }>>(`/announcements`, {
      params: {
        type: params?.type,
        project_id: params?.projectId,
      },
    }).then((response) =>
      response.data.data.announcements.map((announcement) => normalizeAnnouncement(announcement as AnyRecord))
    ),

  createAnnouncement: (data: Partial<Announcement> & { isPinned?: boolean }) =>
    api.post<ApiResponse<unknown>>(`/announcements`, toAnnouncementPayload(data)).then((response) =>
      normalizeAnnouncement(response.data.data as AnyRecord)
    ),

  updateAnnouncement: (id: string, data: Partial<Announcement> & { isPinned?: boolean }) =>
    api.put<ApiResponse<unknown>>(`/announcements/${id}`, toAnnouncementPayload(data)).then((response) =>
      normalizeAnnouncement(response.data.data as AnyRecord)
    ),

  deleteAnnouncement: (id: string) =>
    api.delete<ApiResponse<void>>(`/announcements/${id}`).then(extractData),
};

// ========== Member API ==========

export const memberApi = {
  getMembers: (params?: { status?: string; role?: string; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<{ items: unknown[] }>>('/members', { params }).then((response) => ({
      items: response.data.data.items.map((user) => normalizeUser(user as AnyRecord)),
      total: response.data.data.items.length,
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? response.data.data.items.length,
    })),

  createMember: (data: {
    username: string;
    password: string;
    nickname?: string;
    qq?: string;
    role: string;
    status: "active" | "disabled";
    tagIds?: string[];
  }) =>
    api.post<ApiResponse<unknown>>('/members', {
      username: data.username,
      password: data.password,
      nickname: data.nickname || undefined,
      qq_number: data.qq || undefined,
      role: data.role,
      status: data.status,
      tagIds: data.tagIds,
    }).then((response) => normalizeUser(response.data.data as AnyRecord)),

  updateMemberRole: (id: string, role: string) =>
    api.put<ApiResponse<unknown>>(`/members/${id}/role`, { role }).then((response) =>
      normalizeUser(response.data.data as AnyRecord)
    ),

  updateMemberStatus: (id: string, status: string) =>
    api.put<ApiResponse<unknown>>(`/members/${id}/status`, { status }).then((response) =>
      normalizeUser(response.data.data as AnyRecord)
    ),

  resetPassword: (id: string, password: string) =>
    api.put<ApiResponse<void>>(`/members/${id}/password`, { password }).then(extractData),
};
