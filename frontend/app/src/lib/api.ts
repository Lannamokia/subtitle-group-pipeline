import axios, { AxiosError, type AxiosInstance } from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import type {
  User,
  LoginCredentials,
  RegisterData,
  LoginResponse,
  RegisterResponse,
  PasswordResetRequestResponse,
  QQRebindRequestResponse,
  RegistrationSettings,
  RoleTagDefinition,
  RoleTagApplication,
  UserRoleTagStatus,
  StorageBackend,
  StorageBackendInput,
  Project,
  ProjectUnit,
  UploadPolicy,
  Task,
  TranslationClaim,
  TaskRole,
  FileType,
  TaskComment,
  FileEntity,
  FileVersion,
  FilePreview,
  LinkAsset,
  Notification,
  NotificationPreference,
  ProjectTemplate,
  TemplateRoleConfig,
  ProductConfig,
  TimelineEvent,
  SubtitleConflict,
  WikiDocument,
  Announcement,
  DataRetentionSettings,
  SystemBrandingSettings,
  SmtpSettings,
  QqBridgeSettings,
  GlobalHealthStatus,
  ApiResponse,
  PaginatedResponse,
} from '@/types';

const API_BASE_URL = 'http://localhost:3000/api/v1';
const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return '';
  }
})();
const LARGE_FILE_UPLOAD_TIMEOUT_MS = 12 * 60 * 60 * 1000;

// Create axios instance
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
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
    const errorCode = (error.response?.data as AnyRecord | undefined)?.error?.code;
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      toast.error('登录已过期，请重新登录');
      window.location.href = '/login';
    }
    if (error.response?.status === 503 && errorCode === 'SETUP_REQUIRED') {
      if (window.location.pathname !== '/setup') {
        window.location.href = '/setup';
      }
    }
    if (errorCode === 'DATABASE_CONNECTION_ERROR') {
      toast.error('数据库连接异常，请检查数据库配置', { id: 'database-connection-error' });
    }
    return Promise.reject(error);
  }
);

type AnyRecord = Record<string, any>;

const defaultProductOutput = {
  resolution: "1920x1080",
  frameRate: "23.976",
  encoder: "x264",
  encoderPreset: "slow",
  videoBitrate: "8000k",
  targetSize: "1.5GB",
  audioCodec: "AAC",
  audioBitrate: "192k",
  audioChannels: "2.0",
  extraParams: "",
};

function parseJsonRecord(value: unknown): AnyRecord {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as AnyRecord;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeWorkflowConfig(value: unknown): TemplateRoleConfig[] {
  const arrayEntries = parseJsonArray(value)
    .filter((entry): entry is AnyRecord => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      role: (entry.role ?? "translation") as TaskRole,
      enabled: entry.enabled ?? true,
      slotCount: entry.slotCount ?? entry.slot_count ?? 1,
      assignmentStrategy: (entry.assignmentStrategy ?? entry.assignment_strategy ?? "manual") as "manual" | "open_claim",
      maxSegmentLength: entry.maxSegmentLength ?? entry.max_segment_length,
      requiredTagIds: Array.isArray(entry.requiredTagIds ?? entry.required_tag_ids)
        ? (entry.requiredTagIds ?? entry.required_tag_ids).filter((id: unknown): id is string => typeof id === "string")
        : undefined,
    }));
  if (arrayEntries.length > 0) return arrayEntries;

  return Object.entries(parseJsonRecord(value))
    .filter(([, entry]) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map(([role, entry]) => {
      const record = entry as AnyRecord;
      return {
        role: (record.role ?? role) as TaskRole,
        enabled: record.enabled ?? true,
        slotCount: record.slotCount ?? record.slot_count ?? 1,
        assignmentStrategy: (record.assignmentStrategy ?? record.assignment_strategy ?? "manual") as "manual" | "open_claim",
        maxSegmentLength: record.maxSegmentLength ?? record.max_segment_length,
        requiredTagIds: Array.isArray(record.requiredTagIds ?? record.required_tag_ids)
          ? (record.requiredTagIds ?? record.required_tag_ids).filter((id: unknown): id is string => typeof id === "string")
          : undefined,
      };
    });
}

function findRoleMaxSegmentLength(roles: TemplateRoleConfig[], role: TaskRole): number | null {
  const value = roles.find((entry) => entry.role === role)?.maxSegmentLength;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProductConfig(rawConfig: unknown): ProductConfig {
  const config = parseJsonRecord(rawConfig);
  const legacy = config as AnyRecord;
  const base = {
    ...defaultProductOutput,
    resolution: legacy.resolution ?? defaultProductOutput.resolution,
    encoder: legacy.encoder ?? defaultProductOutput.encoder,
    videoBitrate: legacy.bitrate ?? defaultProductOutput.videoBitrate,
  };
  const outputs = parseJsonRecord(config.outputs);

  return {
    namingRule: String(config.namingRule ?? config.naming_rule ?? "{title}_{ep}_{quality}"),
    outputs: {
      muxed: { ...base, ...parseJsonRecord(outputs.muxed) },
      burned: { ...base, ...parseJsonRecord(outputs.burned) },
    },
  };
}

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
  const rawAvatar = raw.avatar ?? raw.avatar_url;
  return {
    id: raw.id,
    username: raw.username,
    nickname: raw.nickname,
    email: raw.email,
    qq: raw.qq ?? raw.qq_number,
    avatar: normalizeAvatarUrl(typeof rawAvatar === "string" ? rawAvatar : undefined, raw.id),
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

export function toBackendAssetUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^(https?:|data:|blob:)/.test(value)) return value;
  if (!API_ORIGIN) return value;
  if (value.startsWith("/")) return `${API_ORIGIN}${value}`;
  return value;
}

export function normalizeAvatarUrl(value?: string | null, userId?: string): string | undefined {
  if (!value) return undefined;
  if (/^(https?:|data:|blob:)/.test(value)) return value;
  if (value.startsWith("/uploads/") || value.startsWith("/api/")) {
    return toBackendAssetUrl(value);
  }
  if (userId && (value.startsWith("s3://") || value.startsWith("projects/avatars/"))) {
    return `${API_BASE_URL}/storage/avatar/${encodeURIComponent(userId)}/image?v=${encodeURIComponent(value)}`;
  }
  return value;
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
    secretKey: raw.secretKey ?? raw.secret_key,
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

export function normalizeTranslationClaim(raw: AnyRecord): TranslationClaim {
  return {
    id: raw.id,
    taskId: raw.taskId ?? raw.task_id,
    unitId: raw.unitId ?? raw.unit_id ?? null,
    taskName: raw.taskName ?? raw.task_name ?? raw.task?.title,
    translationOrder: raw.translationOrder ?? raw.translation_order ?? raw.task?.translation_order ?? null,
    userId: raw.userId ?? raw.user_id,
    user: raw.user ? normalizeUser(raw.user) : undefined,
    segmentStart: raw.segmentStart ?? raw.segment_start ?? 0,
    segmentEnd: raw.segmentEnd ?? raw.segment_end ?? 0,
    status: raw.status,
    claimedAt: raw.claimedAt ?? raw.claimed_at,
    submittedAt: raw.submittedAt ?? raw.submitted_at ?? null,
    approvedAt: raw.approvedAt ?? raw.approved_at ?? null,
    expiresAt: raw.expiresAt ?? raw.expires_at ?? null,
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
    translationOrder: raw.translationOrder ?? raw.translation_order ?? null,
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
    claims: Array.isArray(raw.claims)
      ? raw.claims.map((claim: AnyRecord) => normalizeTranslationClaim(claim))
      : undefined,
  };
}

export function normalizeProjectUnit(raw: AnyRecord, tasks: Task[] = []): ProjectUnit {
  const id = String(raw.id);
  const unitTasks = tasks.filter((task) => task.unitId === id);
  const completed = unitTasks.filter(isProjectProgressCompletedTask).length;
  const taskCount = unitTasks.length || raw.taskCount || raw._count?.tasks || 0;

  return {
    id,
    projectId: raw.projectId ?? raw.project_id,
    season: raw.season ?? raw.season_number ?? 1,
    episode: raw.episode ?? raw.unit_number,
    title: raw.title ?? null,
    episodeLength: raw.episodeLength ?? raw.episode_length ?? null,
    description: raw.description ?? null,
    taskCount,
    status: raw.status,
    progress: raw.progress ?? (taskCount > 0 ? Math.round((completed / taskCount) * 100) : 0),
    createdAt: raw.createdAt ?? raw.created_at,
    updatedAt: raw.updatedAt ?? raw.updated_at,
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
    assetKind: raw.assetKind ?? raw.asset_kind ?? (raw.url && raw.link_type ? "link" : "binary"),
    type: raw.type ?? raw.file_type ?? "other",
    projectId: raw.projectId ?? raw.project_id,
    taskId: raw.taskId ?? raw.task_id,
    unitId: raw.unitId ?? raw.unit_id,
    role: raw.role,
    url: raw.url,
    fileId: raw.fileId ?? raw.file_id,
    extractCode: raw.extractCode ?? raw.extract_code,
    description: raw.description,
    linkType: raw.linkType ?? raw.link_type,
    linkHistory: Array.isArray(raw.linkHistory ?? raw.link_history)
      ? (raw.linkHistory ?? raw.link_history).map((link: AnyRecord) => normalizeLink(link))
      : undefined,
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
    updatedAt: raw.updatedAt ?? raw.updated_at ?? raw.latest_update_at ?? raw.created_at ?? "",
  };
}

export function normalizeFileVersion(raw: AnyRecord): FileVersion {
  return {
    id: raw.id,
    fileId: raw.fileId ?? raw.file_id,
    versionNumber: raw.versionNumber ?? raw.version_number ?? 1,
    uploader: raw.uploader ? normalizeUser(raw.uploader) : undefined,
    file: raw.file
      ? {
          id: raw.file.id,
          name: raw.file.name ?? raw.file.original_name ?? "未命名文件",
          originalName: raw.file.originalName ?? raw.file.original_name,
          type: raw.file.type ?? raw.file.file_type,
          projectId: raw.file.projectId ?? raw.file.project_id,
        }
      : undefined,
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

export function normalizeFilePreview(raw: AnyRecord): FilePreview {
  const rawVersion = raw.version && typeof raw.version === "object" ? raw.version as AnyRecord : null;
  return {
    kind: raw.kind ?? "unsupported",
    fileId: raw.fileId ?? raw.file_id,
    fileName: raw.fileName ?? raw.file_name ?? raw.name ?? "未命名文件",
    mimeType: raw.mimeType ?? raw.mime_type ?? "application/octet-stream",
    size: raw.size ?? raw.size_bytes ?? rawVersion?.size_bytes ?? 0,
    version: rawVersion
      ? {
          id: rawVersion.id,
          fileId: rawVersion.fileId ?? rawVersion.file_id,
          versionNumber: rawVersion.versionNumber ?? rawVersion.version_number ?? 1,
          size: rawVersion.size ?? rawVersion.size_bytes ?? 0,
          hash: rawVersion.hash ?? rawVersion.checksum,
          isCurrent: rawVersion.isCurrent ?? rawVersion.is_current,
          isLatest: rawVersion.isLatest ?? rawVersion.is_latest,
          isLatestApproved: rawVersion.isLatestApproved ?? rawVersion.is_latest_approved,
          changeSummary: rawVersion.changeSummary ?? rawVersion.change_summary,
          createdAt: rawVersion.createdAt ?? rawVersion.created_at ?? "",
        }
      : null,
    text: typeof raw.text === "string" ? raw.text : undefined,
    encoding: typeof raw.encoding === "string" ? raw.encoding : undefined,
    url: toBackendAssetUrl(raw.url),
    downloadUrl: toBackendAssetUrl(raw.downloadUrl ?? raw.download_url),
    expiresAt: raw.expiresAt ?? raw.expires_at,
    reason: raw.reason,
  };
}

export function normalizeLink(raw: AnyRecord): LinkAsset {
  return {
    id: raw.id,
    projectId: raw.projectId ?? raw.project_id,
    fileId: raw.fileId ?? raw.file_id,
    name: raw.name ?? raw.description ?? raw.link_type ?? "网盘链接",
    url: raw.url,
    extractCode: raw.extractCode ?? raw.extract_code,
    description: raw.description,
    taskId: raw.taskId ?? raw.task_id,
    unitId: raw.unitId ?? raw.unit_id,
    role: raw.role,
    type: raw.type ?? raw.file_type,
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
    projectName: raw.projectName ?? raw.project?.name,
    title: raw.title ?? "",
    content: raw.content ?? "",
    createdBy: raw.createdBy ? normalizeUser(raw.createdBy) : raw.creator ? normalizeUser(raw.creator) : normalizeUser({ id: raw.created_by, username: "Unknown", role: "member", status: "active" }),
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    expiresAt: raw.expiresAt ?? raw.expires_at,
    isPinned: raw.isPinned ?? raw.is_pinned ?? false,
  };
}

export function normalizeSystemBranding(raw: AnyRecord): SystemBrandingSettings {
  return {
    appName: raw.appName ?? raw.app_name ?? "SubtitleSync",
    logoUrl: raw.logoUrl ?? raw.logo_url ?? null,
    logoUpdatedAt: raw.logoUpdatedAt ?? raw.logo_updated_at ?? null,
  };
}

export function normalizeSmtpSettings(raw: AnyRecord): SmtpSettings {
  return {
    enabled: Boolean(raw.enabled),
    host: raw.host ?? "",
    port: Number(raw.port ?? 587),
    secure: Boolean(raw.secure),
    username: raw.username ?? null,
    passwordConfigured: Boolean(raw.passwordConfigured ?? raw.password_configured),
    fromAddress: raw.fromAddress ?? raw.from_address ?? "",
    fromName: raw.fromName ?? raw.from_name ?? null,
    rejectUnauthorized: raw.rejectUnauthorized ?? raw.reject_unauthorized ?? true,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
  };
}

export function normalizeQqBridgeSettings(raw: AnyRecord): QqBridgeSettings {
  return {
    enabled: Boolean(raw.enabled),
    endpoint: raw.endpoint ?? null,
    secretConfigured: Boolean(raw.secretConfigured ?? raw.secret_configured),
    lastHeartbeatAt: raw.lastHeartbeatAt ?? raw.last_heartbeat_at ?? null,
    lastHeartbeatStatus: raw.lastHeartbeatStatus ?? raw.last_heartbeat_status ?? null,
    lastBotId: raw.lastBotId ?? raw.last_bot_id ?? null,
    lastBotNickname: raw.lastBotNickname ?? raw.last_bot_nickname ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
  };
}

export function normalizeGlobalHealth(raw: AnyRecord): GlobalHealthStatus {
  const database = (raw.database ?? {}) as AnyRecord;
  const qqBridge = (raw.qqBridge ?? raw.qq_bridge ?? {}) as AnyRecord;

  return {
    checkedAt: raw.checkedAt ?? raw.checked_at ?? new Date().toISOString(),
    database: {
      connected: Boolean(database.connected),
      type: String(database.type ?? "unknown"),
      version: database.version ?? null,
      error: database.error ?? null,
    },
    qqBridge: {
      configured: Boolean(qqBridge.configured),
      connected: Boolean(qqBridge.connected),
      endpoint: qqBridge.endpoint ?? null,
      tokenConfigured: Boolean(qqBridge.tokenConfigured ?? qqBridge.token_configured),
      lastHeartbeatAt: qqBridge.lastHeartbeatAt ?? qqBridge.last_heartbeat_at ?? null,
      heartbeatStatus: qqBridge.heartbeatStatus ?? qqBridge.heartbeat_status ?? null,
      heartbeatAgeSeconds: qqBridge.heartbeatAgeSeconds ?? qqBridge.heartbeat_age_seconds ?? null,
      botId: qqBridge.botId ?? qqBridge.bot_id ?? null,
      botNickname: qqBridge.botNickname ?? qqBridge.bot_nickname ?? null,
      error: qqBridge.error ?? null,
    },
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
    qq_group_id: data.qqGroupId,
    delivery_checklist: data.deliveryChecklist,
    download_link_ttl_seconds: data.downloadLinkTtlSeconds,
    translation_max_segment_length: data.translationMaxSegmentLength,
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
    roleType: knownRoles.includes(raw.roleType ?? raw.role_type ?? raw.name) ? (raw.roleType ?? raw.role_type ?? raw.name) : "translation",
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

function isProjectProgressCompletedTask(task: Task): boolean {
  return task.status === "completed" || (task.status === "review_approved" && task.role !== "translation");
}

export function normalizeProject(raw: AnyRecord): Project {
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [];
  const units = Array.isArray(raw.units)
    ? raw.units.map((unit) => normalizeProjectUnit(unit as AnyRecord, tasks))
    : [];
  const completed = tasks.filter(isProjectProgressCompletedTask).length;
  const taskCount = tasks.length || raw._count?.tasks || 0;
  const productConfigSource = raw.productConfig ?? raw.product_config ?? raw.template?.product_config;
  const uploadPolicySource =
    raw.uploadPolicy ??
    raw.upload_policy_config ??
    raw.upload_policy ??
    raw.template?.uploadPolicy ??
    raw.template?.upload_policy;
  const uploadPolicy = parseJsonRecord(uploadPolicySource) as UploadPolicy;
  const workflowConfig = normalizeWorkflowConfig(raw.workflowConfig ?? raw.workflow_config);
  const templateWorkflowConfig = normalizeWorkflowConfig(raw.template?.roles);
  const translationMaxSegmentLength =
    findRoleMaxSegmentLength(workflowConfig, "translation") ??
    findRoleMaxSegmentLength(templateWorkflowConfig, "translation");

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
    qqGroupId: raw.qqGroupId ?? raw.qq_group_id,
    members: Array.isArray(raw.members)
      ? raw.members.map((member: AnyRecord) => ({
          user: normalizeUser(member.user ?? member),
          role: member.role,
          joinedAt: member.joinedAt ?? member.joined_at ?? "",
        }))
      : [],
    assignedUserIds: Array.isArray(raw.assignedUserIds)
      ? raw.assignedUserIds
      : Array.isArray(raw.assigned_user_ids)
        ? raw.assigned_user_ids
        : [],
    openClaimRoles: Array.isArray(raw.openClaimRoles)
      ? raw.openClaimRoles
      : Array.isArray(raw.open_claim_roles)
        ? raw.open_claim_roles
        : [],
    units,
    tasks,
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
    productConfig: productConfigSource ? normalizeProductConfig(productConfigSource) : undefined,
    uploadPolicy: Object.keys(uploadPolicy).length > 0 ? uploadPolicy : undefined,
    releaseTaskType: raw.releaseTaskType ?? raw.release_task_type ?? raw.template?.release_task_type,
    downloadLinkTtlSeconds: raw.downloadLinkTtlSeconds ?? raw.download_link_ttl_seconds,
    translationMaxSegmentLength,
    workflowConfig,
    wikiApprovalRequired: raw.wikiApprovalRequired ?? raw.wiki_approval_required,
    createdAt: raw.createdAt ?? raw.created_at ?? "",
    updatedAt: raw.updatedAt ?? raw.updated_at ?? "",
  };
}

// Helper for error messages
function translateValidationMessage(path: string, message: string): string {
  const fieldLabels: Record<string, string> = {
    username: "用户名",
    password: "密码",
    newPassword: "新密码",
    currentPassword: "当前密码",
    qq: "QQ号",
    qq_number: "QQ号",
    email: "邮箱",
    nickname: "昵称",
    role: "系统角色",
    status: "账号状态",
    tagIds: "岗位标签",
  };
  const label = fieldLabels[path] ?? path;

  if (/at least 8 characters/i.test(message)) return `${label}至少需要 8 个字符`;
  if (/at most 128 characters/i.test(message)) return `${label}最多 128 个字符`;
  if (/at most 30 characters/i.test(message)) return `${label}最多 30 个字符`;
  if (/at least 3 characters/i.test(message)) return `${label}至少需要 3 个字符`;
  if (/include at least one letter/i.test(message)) return `${label}至少需要包含 1 个英文字母`;
  if (/include at least one number/i.test(message)) return `${label}至少需要包含 1 个数字`;
  if (/no spaces|not contain spaces/i.test(message)) return `${label}不能包含空格或换行`;
  if (/only contain letters, numbers, underscores, and hyphens/i.test(message)) {
    return `${label}只能包含英文字母、数字、下划线和连字符`;
  }
  if (/invalid email/i.test(message)) return "邮箱格式不正确";
  if (/invalid tag id/i.test(message)) return "岗位标签无效，请刷新后重试";

  return `${label}: ${message}`;
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data as AnyRecord | undefined;
    const responseError = responseData?.error as AnyRecord | undefined;
    const message = responseError?.message || responseData?.message || error.message || '请求失败';
    const code = responseError?.code;
    const details = responseError?.details;

    if (code === 'VALIDATION_ERROR' && Array.isArray(details) && details.length > 0) {
      return details
        .map((detail) => {
          const record = detail as AnyRecord;
          return translateValidationMessage(String(record.path ?? "字段"), String(record.message ?? message));
        })
        .join("；");
    }

    if (code === 'DUPLICATE_ERROR') {
      if (message.includes('Username')) return '用户名已被使用，请换一个用户名';
      if (message.includes('QQ')) return 'QQ号已被其他账号使用，请检查后重新填写';
      if (message.includes('Email')) return '邮箱已被注册，请换一个邮箱';
      return '账号信息已存在，请检查用户名、QQ号或邮箱是否重复';
    }

    if (code === 'VALIDATION_ERROR') {
      return message === 'Validation failed' ? '提交内容不符合要求，请检查表单后重试' : message;
    }

    return message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '未知错误';
}

// ========== Auth API ==========

export const authApi = {
  login: (credentials: LoginCredentials) =>
    api.post<ApiResponse<LoginResponse>>('/auth/login', credentials).then((response) => {
      const data = extractData(response);
      return data.user ? { ...data, user: normalizeUser(data.user as AnyRecord) } : data;
    }),

  register: (data: RegisterData) =>
    api.post<ApiResponse<RegisterResponse>>('/auth/register', {
      username: data.username,
      password: data.password,
      qq_number: data.qq,
      tags: data.tags,
    }).then((response) => {
      const result = extractData(response);
      return result.user ? { ...result, user: normalizeUser(result.user as AnyRecord) } : result;
    }),

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

  requestPasswordReset: (data: { username: string }) =>
    api.post<ApiResponse<PasswordResetRequestResponse>>('/auth/request-password-reset', data).then(extractData),

  confirmPasswordReset: (data: { username: string; code: string; password: string }) =>
    api.post<ApiResponse<{ success: boolean }>>('/auth/confirm-password-reset', data).then(extractData),

  requestQQRebind: (data: { qq?: string; qqNumber?: string }) =>
    api.post<ApiResponse<QQRebindRequestResponse>>('/auth/qq-rebind/request', {
      qq_number: data.qqNumber ?? data.qq,
    }).then(extractData),

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
    api.post<ApiResponse<unknown>>('/auth/role-tags', {
      name: data.name,
      roleType: data.roleType,
      description: data.description,
    }).then((response) => normalizeRoleTag(response.data.data as AnyRecord)),

  updateTag: (id: string, data: { name?: string; roleType?: string; description?: string }) =>
    api.put<ApiResponse<unknown>>(`/auth/role-tags/${id}`, {
      name: data.name,
      roleType: data.roleType,
      description: data.description,
    }).then((response) => normalizeRoleTag(response.data.data as AnyRecord)),

  deleteTag: (id: string) =>
    api.delete<ApiResponse<void>>(`/auth/role-tags/${id}`).then(extractData),

  getMyTagStatuses: () =>
    api.get<ApiResponse<unknown[]>>('/auth/role-tags/my-status').then((response) =>
      response.data.data.map((item) => {
        const raw = item as AnyRecord;
        return {
          tag: normalizeRoleTag(raw.tag as AnyRecord),
          status: raw.status,
        } as UserRoleTagStatus;
      })
    ),

  resetMyTagStatuses: (tagIds: string[]) =>
    api.post<ApiResponse<{ resetCount: number; statuses: unknown[] }>>('/auth/role-tags/my-status/reset', { tagIds })
      .then((response) =>
        response.data.data.statuses.map((item) => {
          const raw = item as AnyRecord;
          return {
            tag: normalizeRoleTag(raw.tag as AnyRecord),
            status: raw.status,
          } as UserRoleTagStatus;
        })
      ),

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

  uploadAvatar: (file: File, userId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    const endpointUrl = userId ? `/storage/avatar/${userId}` : '/storage/avatar';
    return api.post<ApiResponse<unknown>>(endpointUrl, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((response) => {
      const raw = response.data.data as AnyRecord;
      const storageUrl = String(raw.avatarUrl ?? raw.avatar_url ?? raw.url ?? "");
      if (!storageUrl) {
        throw new Error("头像上传响应缺少 URL");
      }
      const previewUserId = userId ?? useAuthStore.getState().user?.id;
      const previewUrl = normalizeAvatarUrl(storageUrl, previewUserId) ?? storageUrl;
      return {
        url: previewUrl,
        avatarUrl: previewUrl,
        storageUrl,
        size: Number(raw.size ?? 0),
      };
    });
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

// ========== System API ==========

export const systemApi = {
  getBranding: () =>
    api.get<ApiResponse<unknown>>('/system/branding').then((response) =>
      normalizeSystemBranding(response.data.data as AnyRecord)
    ),

  updateBranding: (data: { appName: string }) =>
    api.put<ApiResponse<unknown>>('/system/branding', { app_name: data.appName }).then((response) =>
      normalizeSystemBranding(response.data.data as AnyRecord)
    ),

  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<ApiResponse<unknown>>('/system/branding/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((response) =>
      normalizeSystemBranding(response.data.data as AnyRecord)
    );
  },

  getSmtpSettings: () =>
    api.get<ApiResponse<unknown>>('/system/smtp').then((response) =>
      normalizeSmtpSettings(response.data.data as AnyRecord)
    ),

  updateSmtpSettings: (data: SmtpSettings) =>
    api.put<ApiResponse<unknown>>('/system/smtp', {
      enabled: data.enabled,
      host: data.host,
      port: data.port,
      secure: data.secure,
      username: data.username || null,
      password: data.password || null,
      from_address: data.fromAddress,
      from_name: data.fromName || null,
      reject_unauthorized: data.rejectUnauthorized,
    }).then((response) =>
      normalizeSmtpSettings(response.data.data as AnyRecord)
    ),

  testSmtpSettings: (data: { to: string }) =>
    api.post<ApiResponse<{ success: boolean; message_id?: string }>>('/system/smtp/test', {
      to: data.to,
    }).then(extractData),

  getQqBridgeSettings: () =>
    api.get<ApiResponse<unknown>>('/system/qq-bridge').then((response) =>
      normalizeQqBridgeSettings(response.data.data as AnyRecord)
    ),

  updateQqBridgeSettings: (data: QqBridgeSettings) =>
    api.put<ApiResponse<unknown>>('/system/qq-bridge', {
      enabled: data.enabled,
      endpoint: data.endpoint || null,
      secret: data.secret || null,
    }).then((response) =>
      normalizeQqBridgeSettings(response.data.data as AnyRecord)
    ),

  testQqBridgeSettings: (data: { groupId: string; atUserQQ: string }) =>
    api.post<ApiResponse<{ success: boolean; message_id?: string }>>('/system/qq-bridge/test', {
      group_id: data.groupId,
      at_user_qq: data.atUserQQ,
    }).then(extractData),

  getGlobalHealth: () =>
    api.get<ApiResponse<unknown>>('/system/health').then((response) =>
      normalizeGlobalHealth(response.data.data as AnyRecord)
    ),
};

// ========== Setup API ==========

export const setupApi = {
  getStatus: () =>
    api.get<ApiResponse<{
      initialized: boolean;
      databaseReady: boolean;
      adminExists: boolean;
      storageReady: boolean;
      provider: string;
    }>>('/setup/status').then(extractData),

  complete: (data: {
    database: { provider: "sqlite" | "mysql" | "mariadb" | "postgresql"; url: string };
    security: { jwt_secret: string };
    admin: { username: string; password: string; nickname?: string; email?: string };
    storage: { name: string; backend_type: "local" | "s3" | "s3_compatible"; config: string; quota_bytes?: number | null };
  }) =>
    api.post<ApiResponse<unknown>>('/setup/complete', data).then(extractData),
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

  permanentlyDeleteProject: (id: string) =>
    api.delete<ApiResponse<void>>(`/projects/${id}/permanent`).then(extractData),

  updateUnitCount: (
    id: string,
    data: {
      season: number;
      episodes: number;
      episodeLength?: number | null;
      deleteUnitIds?: string[];
      forceDeleteNonEmpty?: boolean;
    }
  ) => {
    const payload: AnyRecord = {
      season_number: data.season,
      units_per_season: data.episodes,
      delete_unit_ids: data.deleteUnitIds,
      force_delete_non_empty: data.forceDeleteNonEmpty ?? false,
    };
    if (data.episodeLength !== undefined) {
      payload.episode_length = data.episodeLength;
    }
    return api.put<ApiResponse<unknown[]>>(`/projects/${id}/units/count`, payload).then((response) =>
      unwrapItems<unknown>(response.data.data).map((unit) => normalizeProjectUnit(unit as AnyRecord))
    );
  },

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

  deleteTask: (id: string) =>
    api.delete<ApiResponse<{ success: boolean; id: string }>>(`/tasks/${id}`).then(extractData),

  claimTask: (id: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/claim`).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  claimSegment: (id: string, data: { segmentStart: number; segmentEnd: number }) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/claim-segment`, {
      segment_start: data.segmentStart,
      segment_end: data.segmentEnd,
    }).then((response) => normalizeTranslationClaim(response.data.data as AnyRecord)),

  abandonSegment: (taskId: string, claimId: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${taskId}/abandon-segment/${claimId}`).then((response) =>
      normalizeTranslationClaim(response.data.data as AnyRecord)
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

  resetTask: (id: string, reason?: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/reset`, { reason: reason || undefined }).then((response) =>
      normalizeTask(response.data.data as AnyRecord)
    ),

  createDependency: (id: string, dependsOnId: string) =>
    api.post<ApiResponse<unknown>>(`/tasks/${id}/dependencies`, {
      depends_on_id: dependsOnId,
      dependency_type: "finish_to_start",
    }).then(extractData),

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

type FileUploadData = {
  projectId: string;
  taskId?: string;
  unitId?: string;
  type?: string;
  role?: string;
  tags?: string[];
  changeSummary?: string;
  episodeLength?: number | null;
};

type ReplaceUploadData = {
  changeSummary?: string;
  tags?: string[];
};

type MultipartUploadSession = {
  uploadMode?: 'multipart' | 'server';
  mode?: 'multipart' | 'server';
  storageBackendId?: string;
  storage_backend_id?: string;
  key?: string;
  uploadId?: string;
  upload_id?: string;
  partSize?: number;
  part_size?: number;
  partCount?: number;
  part_count?: number;
};

function buildServerUploadFormData(file: File, data: FileUploadData): FormData {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('projectId', data.projectId);
  if (data.taskId) formData.append('taskId', data.taskId);
  if (data.unitId) formData.append('unitId', data.unitId);
  if (data.type) formData.append('type', data.type);
  if (data.role) formData.append('role', data.role);
  if (data.tags?.length) formData.append('tags', JSON.stringify(data.tags));
  if (data.changeSummary) formData.append('change_summary', data.changeSummary);
  if (data.episodeLength !== undefined && data.episodeLength !== null) {
    formData.append('episode_length', String(data.episodeLength));
  }
  return formData;
}

function buildServerReplaceFormData(file: File, data?: ReplaceUploadData): FormData {
  const formData = new FormData();
  formData.append('file', file);
  if (data?.changeSummary) formData.append('change_summary', data.changeSummary);
  if (data?.tags?.length) formData.append('tags', JSON.stringify(data.tags));
  return formData;
}

function serverUploadFile(file: File, data: FileUploadData) {
  return api.post<ApiResponse<unknown>>('/files', buildServerUploadFormData(file, data), {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: LARGE_FILE_UPLOAD_TIMEOUT_MS,
  }).then((response) => normalizeFile(response.data.data as AnyRecord));
}

function serverReplaceFile(fileId: string, file: File, data?: ReplaceUploadData) {
  return api.post<ApiResponse<unknown>>(`/files/${fileId}/replace`, buildServerReplaceFormData(file, data), {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: LARGE_FILE_UPLOAD_TIMEOUT_MS,
  }).then((response) => normalizeFile(response.data.data as AnyRecord));
}

function multipartInitPayload(file: File, data: FileUploadData, fileId?: string) {
  return {
    project_id: data.projectId,
    file_id: fileId,
    name: file.name,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
    type: data.type,
    role: data.role,
    task_id: data.taskId,
    unit_id: data.unitId,
    tags: data.tags,
    change_summary: data.changeSummary,
    episode_length: data.episodeLength,
  };
}

function getMultipartMode(session: MultipartUploadSession): 'multipart' | 'server' {
  return session.uploadMode ?? session.mode ?? 'server';
}

function requireMultipartSessionValue(value: unknown, label: string): string {
  if (typeof value === 'string' && value) return value;
  throw new Error(`分片上传初始化响应缺少 ${label}`);
}

async function uploadMultipartParts(file: File, session: MultipartUploadSession) {
  const storageBackendId = requireMultipartSessionValue(
    session.storageBackendId ?? session.storage_backend_id,
    'storageBackendId'
  );
  const key = requireMultipartSessionValue(session.key, 'key');
  const uploadId = requireMultipartSessionValue(session.uploadId ?? session.upload_id, 'uploadId');
  const partSize = Number(session.partSize ?? session.part_size ?? 0);
  const partCount = Number(session.partCount ?? session.part_count ?? Math.ceil(file.size / partSize));
  if (!partSize || !partCount) {
    throw new Error('分片上传初始化响应缺少分片大小');
  }

  const completedParts: Array<{ partNumber: number; eTag: string }> = [];
  let nextPartNumber = 1;
  const workerCount = Math.min(4, partCount);

  const uploadOne = async () => {
    while (nextPartNumber <= partCount) {
      const partNumber = nextPartNumber;
      nextPartNumber += 1;
      const start = (partNumber - 1) * partSize;
      const end = Math.min(file.size, start + partSize);
      const { data } = await api.post<ApiResponse<{ url: string }>>('/files/multipart/part', {
        storage_backend_id: storageBackendId,
        key,
        upload_id: uploadId,
        part_number: partNumber,
      });
      const url = data.data?.url;
      if (!url) {
        throw new Error('后端没有返回分片上传地址');
      }

      const response = await axios.put(url, file.slice(start, end), {
        timeout: LARGE_FILE_UPLOAD_TIMEOUT_MS,
      });
      const eTag = response.headers.etag || response.headers.ETag;
      if (!eTag) {
        throw new Error('S3 未返回 ETag，请检查存储桶 CORS 是否暴露 ETag 响应头');
      }
      completedParts.push({ partNumber, eTag });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, uploadOne));
  completedParts.sort((a, b) => a.partNumber - b.partNumber);
  return { storageBackendId, key, uploadId, parts: completedParts };
}

async function multipartUploadFile(file: File, data: FileUploadData) {
  const init = await api.post<ApiResponse<MultipartUploadSession>>(
    '/files/multipart/initiate',
    multipartInitPayload(file, data)
  ).then(extractData);

  if (getMultipartMode(init) !== 'multipart') {
    return serverUploadFile(file, data);
  }

  const uploaded = {
    storageBackendId: requireMultipartSessionValue(init.storageBackendId ?? init.storage_backend_id, 'storageBackendId'),
    key: requireMultipartSessionValue(init.key, 'key'),
    uploadId: requireMultipartSessionValue(init.uploadId ?? init.upload_id, 'uploadId'),
    parts: [] as Array<{ partNumber: number; eTag: string }>,
  };
  try {
    const partsResult = await uploadMultipartParts(file, init);
    uploaded.parts = partsResult.parts;
    return await api.post<ApiResponse<unknown>>('/files/multipart/complete', {
      ...multipartInitPayload(file, data),
      storage_backend_id: uploaded.storageBackendId,
      key: uploaded.key,
      upload_id: uploaded.uploadId,
      parts: uploaded.parts.map((part) => ({
        part_number: part.partNumber,
        e_tag: part.eTag,
      })),
    }).then((response) => normalizeFile(response.data.data as AnyRecord));
  } catch (error) {
    await api.post('/files/multipart/abort', {
      storage_backend_id: uploaded.storageBackendId,
      key: uploaded.key,
      upload_id: uploaded.uploadId,
    }).catch(() => undefined);
    throw error;
  }
}

async function multipartReplaceFile(fileId: string, file: File, data?: ReplaceUploadData) {
  const initPayload = {
    ...multipartInitPayload(file, {
      projectId: '00000000-0000-0000-0000-000000000000',
      tags: data?.tags,
      changeSummary: data?.changeSummary,
    }, fileId),
    project_id: undefined,
  };
  const init = await api.post<ApiResponse<MultipartUploadSession>>(
    '/files/multipart/initiate',
    initPayload
  ).then(extractData);

  if (getMultipartMode(init) !== 'multipart') {
    return serverReplaceFile(fileId, file, data);
  }

  const uploaded = {
    storageBackendId: requireMultipartSessionValue(init.storageBackendId ?? init.storage_backend_id, 'storageBackendId'),
    key: requireMultipartSessionValue(init.key, 'key'),
    uploadId: requireMultipartSessionValue(init.uploadId ?? init.upload_id, 'uploadId'),
    parts: [] as Array<{ partNumber: number; eTag: string }>,
  };
  try {
    const partsResult = await uploadMultipartParts(file, init);
    uploaded.parts = partsResult.parts;
    return await api.post<ApiResponse<unknown>>('/files/multipart/complete', {
      ...initPayload,
      storage_backend_id: uploaded.storageBackendId,
      key: uploaded.key,
      upload_id: uploaded.uploadId,
      parts: uploaded.parts.map((part) => ({
        part_number: part.partNumber,
        e_tag: part.eTag,
      })),
    }).then((response) => normalizeFile(response.data.data as AnyRecord));
  } catch (error) {
    await api.post('/files/multipart/abort', {
      storage_backend_id: uploaded.storageBackendId,
      key: uploaded.key,
      upload_id: uploaded.uploadId,
    }).catch(() => undefined);
    throw error;
  }
}

export const fileApi = {
  getFiles: (params?: { projectId?: string; taskId?: string; type?: string; search?: string; tag?: string; role?: string }) =>
    api.get<ApiResponse<unknown>>('/files', { params }).then((response) =>
      unwrapPaginated(response, normalizeFile)
    ),

  getFile: (id: string) =>
    api.get<ApiResponse<unknown>>(`/files/${id}`).then((response) =>
      normalizeFile(response.data.data as AnyRecord)
    ),

  uploadFile: (file: File, data: FileUploadData) => multipartUploadFile(file, data),

  replaceFile: (fileId: string, file: File, data?: ReplaceUploadData) => multipartReplaceFile(fileId, file, data),

  getVersions: (fileId: string) =>
    api.get<ApiResponse<unknown[]>>(`/files/${fileId}/versions`).then((response) =>
      response.data.data.map((version) => normalizeFileVersion(version as AnyRecord))
    ),

  getPreview: (fileId: string, versionId?: string) =>
    api.get<ApiResponse<unknown>>(`/files/${fileId}/preview`, {
      params: versionId ? { version_id: versionId } : undefined,
    }).then((response) => normalizeFilePreview(response.data.data as AnyRecord)),

  approveVersion: (fileId: string, versionId: string) =>
    api.post<ApiResponse<unknown>>(`/files/${fileId}/versions/${versionId}/approve`).then((response) =>
      normalizeFileVersion(response.data.data as AnyRecord)
    ),

  downloadFile: (fileId: string) =>
    api.post<ApiResponse<{ url?: string; downloadUrl?: string }>>(`/files/${fileId}/download`).then((response) =>
      response.data.data?.url ?? response.data.data?.downloadUrl ?? ""
    ),

  downloadVersion: (fileId: string, versionId: string) =>
    api.post<ApiResponse<{ url?: string; downloadUrl?: string }>>(`/files/${fileId}/versions/${versionId}/download`).then((response) =>
      response.data.data?.url ?? response.data.data?.downloadUrl ?? ""
    ),

  getLinks: (params?: { projectId?: string }) =>
    api.get<ApiResponse<unknown[]>>('/files/links', { params }).then((response) =>
      response.data.data.map((link) => normalizeLink(link as AnyRecord))
    ),

  createLink: (data: {
    projectId: string;
    name?: string;
    url: string;
    extractCode?: string;
    description?: string;
    taskId?: string;
    unitId?: string;
    role?: TaskRole;
    type?: FileType;
    tags?: string[];
    episodeLength?: number | null;
  }) =>
    api.post<ApiResponse<unknown>>('/files/links', {
      projectId: data.projectId,
      name: data.name,
      url: data.url,
      extractCode: data.extractCode,
      description: data.description,
      taskId: data.taskId,
      unitId: data.unitId,
      role: data.role,
      type: data.type,
      tags: data.tags,
      episode_length: data.episodeLength ?? undefined,
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
  getAnnouncements: (params?: { type?: string; projectId?: string; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<{ announcements: Announcement[] }>>(`/announcements`, {
      params: {
        type: params?.type,
        project_id: params?.projectId,
        page: params?.page,
        pageSize: params?.pageSize,
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

  updateMemberProfile: (id: string, data: {
    username?: string;
    nickname?: string | null;
    email?: string | null;
    qq?: string | null;
    avatarUrl?: string | null;
  }) =>
    api.put<ApiResponse<unknown>>(`/members/${id}/profile`, {
      username: data.username,
      nickname: data.nickname,
      email: data.email,
      qq_number: data.qq,
      avatar_url: data.avatarUrl,
    }).then((response) => normalizeUser(response.data.data as AnyRecord)),

  updateMemberRole: (id: string, role: string) =>
    api.put<ApiResponse<unknown>>(`/members/${id}/role`, { role }).then((response) =>
      normalizeUser(response.data.data as AnyRecord)
    ),

  updateMemberStatus: (id: string, status: string) =>
    api.put<ApiResponse<unknown>>(`/members/${id}/status`, { status }).then((response) =>
      normalizeUser(response.data.data as AnyRecord)
    ),

  approveVerification: (id: string) =>
    api.post<ApiResponse<unknown>>(`/members/${id}/verify`).then((response) =>
      normalizeUser(response.data.data as AnyRecord)
    ),

  resetPassword: (id: string, password: string) =>
    api.put<ApiResponse<void>>(`/members/${id}/password`, { password }).then(extractData),

  getMemberTagStatuses: (id: string) =>
    api.get<ApiResponse<unknown[]>>(`/members/${id}/tags/statuses`).then((response) =>
      response.data.data.map((item) => {
        const raw = item as AnyRecord;
        return {
          tag: normalizeRoleTag(raw.tag as AnyRecord),
          status: raw.status,
        } as UserRoleTagStatus;
      })
    ),

  resetMemberTagStatuses: (id: string, tagIds: string[]) =>
    api.post<ApiResponse<{ items: unknown[] }>>(`/members/${id}/tags/reset`, { tagIds }).then((response) =>
      response.data.data.items.map((user) => normalizeUser(user as AnyRecord))
    ),

  grantMemberTags: (id: string, tagIds: string[]) =>
    api.post<ApiResponse<unknown>>(`/members/${id}/tags/grant`, { tagIds }).then((response) =>
      normalizeUser(response.data.data as AnyRecord)
    ),

  deleteMember: (id: string) =>
    api.delete<ApiResponse<void>>(`/members/${id}`).then(extractData),
};
