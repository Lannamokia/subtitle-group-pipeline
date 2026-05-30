// ========== Auth Types ==========

export type UserRole = 'super_admin' | 'group_admin' | 'supervisor' | 'member';

export type UserStatus = 'active' | 'pending_verification' | 'disabled';

export type RegistrationMode = 'disabled' | 'open' | 'qq_verification';

export interface User {
  id: string;
  username: string;
  nickname?: string;
  qq?: string;
  avatar?: string;
  role: UserRole;
  status: UserStatus;
  tags?: RoleTag[];
  roleTags?: RoleTagDefinition[];
  token?: string;
  refreshToken?: string;
  createdAt: string;
}

export interface RoleTag {
  id: string;
  name: string;
  status: 'pending' | 'granted' | 'rejected';
  roleType: TaskRole;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  password: string;
  confirmPassword: string;
  qq: string;
  tags: string[];
}

export interface VerificationStatus {
  qqGroup: string;
  command: string;
  verified: boolean;
}

// ========== Project Types ==========

export type ProjectStatus = 'active' | 'completed' | 'archived' | 'deleted';

export type ProjectType = 'anime' | 'movie' | 'ova' | 'special' | 'music_video' | 'other' | 'collection';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  season: number;
  episodes: number;
  tags: string[];
  supervisorId: string;
  supervisor: User;
  members: ProjectMember[];
  progress: number;
  archivedAt?: string;
  deletedAt?: string;
  deliveryChecklist?: DeliveryItem[];
  downloadLinkTtlSeconds?: number;
  wikiApprovalRequired?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  user: User;
  role: TaskRole;
  joinedAt: string;
}

export interface ProjectUnit {
  id: string;
  projectId: string;
  season: number;
  episode: number;
  episodeLength: number;
  status: ProjectStatus;
  progress: number;
}

// ========== Task Types ==========

export type TaskRole = 'source' | 'timing' | 'translation' | 'post_production' | 'encoding' | 'release' | 'supervisor';

export type TaskStatus =
  | 'pending_publish'
  | 'claimable'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'review_approved'
  | 'review_rejected'
  | 'completed'
  | 'overdue'
  | 'frozen';

export interface Task {
  id: string;
  name: string;
  projectId: string;
  project?: Project;
  unitId?: string;
  role: TaskRole;
  status: TaskStatus;
  assigneeId?: string;
  assignee?: User;
  deadline?: string;
  description?: string;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  fileCount?: number;
}

export interface TaskComment {
  id: string;
  taskId: string;
  user: User;
  content: string;
  fileVersionId?: string;
  fileVersion?: FileVersion;
  lineNumber?: number;
  mentions: string[];
  createdAt: string;
}

export interface Review {
  id: string;
  taskId: string;
  reviewer: User;
  status: 'pending' | 'approved' | 'rejected';
  comment?: string;
  snapshot?: ReviewSnapshot;
  createdAt: string;
}

export interface ReviewSnapshot {
  versionId: string;
  hash: string;
  metadata: Record<string, unknown>;
}

// ========== File Types ==========

export type FileType = 'video' | 'subtitle' | 'font' | 'project_package' | 'other';

export type StorageType = 'local' | 's3';

export type VersionPointer = 'current' | 'latest' | 'latest_approved';

export interface FileEntity {
  id: string;
  name: string;
  type: FileType;
  projectId: string;
  taskId?: string;
  uploader: User;
  size: number;
  hash?: string;
  storageType: StorageType;
  isSensitive: boolean;
  tags: string[];
  currentVersionId?: string;
  latestVersionId?: string;
  latestApprovedVersionId?: string;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersion {
  id: string;
  fileId: string;
  versionNumber: number;
  uploader?: User;
  size: number;
  hash?: string;
  storagePath: string;
  isApproved: boolean;
  isCurrent?: boolean;
  isLatest?: boolean;
  isLatestApproved?: boolean;
  changeSummary?: string;
  createdAt: string;
}

export interface LinkAsset {
  id: string;
  projectId: string;
  name: string;
  url: string;
  extractCode?: string;
  description?: string;
  createdBy: User;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadLink {
  id: string;
  fileVersionId: string;
  url: string;
  expiresAt: string;
}

// ========== Notification Types ==========

export type NotificationType = 'task' | 'review' | 'file' | 'system' | 'mention';

export type NotificationChannel = 'in_site' | 'email' | 'qq';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  isRead: boolean;
  channels: NotificationChannel[];
  deliveries?: NotificationDelivery[];
  relatedId?: string;
  relatedType?: string;
  createdAt: string;
}

export interface NotificationDelivery {
  id: string;
  channel: NotificationChannel;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  sentAt?: string;
}

export interface NotificationPreference {
  inSite: boolean;
  email: boolean;
  qq: boolean;
  escalationEnabled: boolean;
  escalationInterval: number;
  subscribedTypes: NotificationType[];
}

// ========== Template Types ==========

export interface ProjectTemplate {
  id: string;
  name: string;
  type: ProjectType;
  description?: string;
  roles: TemplateRoleConfig[];
  uploadPolicy: UploadPolicy;
  notificationPolicy: NotificationPolicy;
  assPolicy: AssPolicy;
  productConfig: ProductConfig;
  deliveryChecklist: DeliveryItem[];
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateRoleConfig {
  role: TaskRole;
  enabled: boolean;
  slotCount: number;
  assignmentStrategy: 'manual' | 'open_claim';
  maxSegmentLength?: number;
  requiredTagIds?: string[];
}

export interface UploadPolicy {
  allowedTypes: Record<TaskRole, FileType[]>;
}

export interface NotificationPolicy {
  events: Record<string, NotificationChannel[]>;
}

export interface AssPolicy {
  mergeRule: string;
  dedupThreshold: number;
}

export interface ProductConfig {
  namingRule: string;
  outputs: {
    muxed: ProductOutputConfig;
    burned: ProductOutputConfig;
  };
}

export interface ProductOutputConfig {
  resolution: string;
  frameRate: string;
  encoder: string;
  encoderPreset: string;
  videoBitrate: string;
  targetSize: string;
  audioCodec: string;
  audioBitrate: string;
  audioChannels: string;
  extraParams: string;
}

export interface DeliveryItem {
  id: string;
  name: string;
  role: TaskRole;
  required: boolean;
}

// ========== Wiki Types ==========

export type WikiBlockType = 'markdown' | 'table';

export type WikiStatus = 'draft' | 'pending' | 'approved';

export interface WikiDocument {
  id: string;
  projectId: string;
  title: string;
  blocks: WikiBlock[];
  status: WikiStatus;
  pendingContent?: string;
  displayContent?: string;
  pendingDiff?: { from: string; to: string } | null;
  approvalRequired?: boolean;
  updatedBy: User;
  updatedAt: string;
}

export interface WikiBlock {
  id: string;
  type: WikiBlockType;
  content: string;
  data?: Record<string, unknown>;
}

// ========== Timeline Types ==========

export type TimelineEventType =
  | 'project_created'
  | 'project_started'
  | 'project_paused'
  | 'project_resumed'
  | 'project_completed'
  | 'project_archived'
  | 'project_unarchived'
  | 'project_deleted'
  | 'project_restored'
  | 'task_created'
  | 'task_claimed'
  | 'task_assigned'
  | 'task_started'
  | 'task_submitted'
  | 'task_approved'
  | 'task_rejected'
  | 'task_reset'
  | 'task_cancelled'
  | 'task_returned'
  | 'task_completed'
  | 'task_overdue'
  | 'task_frozen'
  | 'member_joined'
  | 'member_left'
  | 'member_added'
  | 'member_removed'
  | 'join_request_created'
  | 'join_request_approved'
  | 'join_request_rejected'
  | 'file_uploaded'
  | 'review_submitted'
  | 'review_approved'
  | 'review_rejected'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'milestone_reached'
  | 'wiki_updated'
  | 'wiki_approved'
  | 'wiki_rejected'
  | 'announcement'
  | 'task_status'
  | 'file_upload'
  | 'member_join'
  | 'review'
  | 'system'
  | 'custom';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  projectId?: string;
  projectName?: string;
  description: string;
  user?: User;
  createdAt: string;
}

// ========== Dedup Types ==========

export interface SubtitleConflict {
  id: string;
  mergeJobId: string;
  startTime: number;
  endTime: number;
  conflictType: 'exact_duplicate' | 'text_conflict' | 'overlap';
  translations: ConflictTranslation[];
  resolution?: ConflictResolution;
}

export interface ConflictTranslation {
  translatorId: string;
  translatorName: string;
  text: string;
  style: string;
}

export interface ConflictResolution {
  keepTranslationId?: string;
  mergedText?: string;
  status: 'pending' | 'resolved' | 'deferred';
}

// ========== Announcement Types ==========

export interface Announcement {
  id: string;
  type: 'global' | 'project';
  projectId?: string;
  projectName?: string;
  title: string;
  content: string;
  createdBy: User;
  createdAt: string;
  expiresAt?: string;
  isPinned?: boolean;
}

// ========== Admin Types ==========

export interface RegistrationSettings {
  mode: RegistrationMode;
  qqGroup?: string;
  codeLength: number;
  roleTagEnabled: boolean;
}

export interface DataRetentionSettings {
  id?: string;
  archiveCleanupDays: number;
  archiveRetentionDays?: number;
  autoArchiveDays?: number;
  autoDeleteDays?: number | null;
  recycleBinDays: number;
  auditLogRetentionDays?: number;
  notificationRetentionDays?: number;
  maxFileVersions?: number;
  downloadLinkTtl: number;
  linkCleanupInterval: number;
  wikiApprovalRequired?: boolean;
}

export interface SystemBrandingSettings {
  appName: string;
  logoUrl?: string | null;
  logoUpdatedAt?: string | null;
}

// ========== Role Tag Types ==========

export interface RoleTagDefinition {
  id: string;
  name: string;
  roleType: TaskRole;
  description?: string;
  createdAt: string;
}

export interface RoleTagApplication {
  id: string;
  userId: string;
  user: User;
  tagId: string;
  tag: RoleTagDefinition;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: User;
  reviewComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleTagStatus {
  tag: RoleTagDefinition;
  status: 'pending' | 'granted' | 'rejected' | 'not_applied';
}

// ========== Storage Types ==========

export interface StorageBackend {
  id: string;
  name: string;
  type: StorageType;
  endpoint: string;
  bucket?: string;
  rootPath?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  quotaBytes: number;
  usedBytes: number;
  isDefault: boolean;
  isEnabled: boolean;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StorageBackendInput {
  name: string;
  type: StorageType;
  endpoint: string;
  bucket?: string;
  rootPath?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  quotaBytes: number;
  isDefault: boolean;
  isEnabled: boolean;
}

// ========== API Response Types ==========

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LoginResponse {
  user?: User;
  token?: string;
  refreshToken?: string;
  status?: 'active' | 'pending_verification';
  requiresVerification?: boolean;
  verification?: {
    qqGroup: string;
    command: string;
  };
  qqGroup?: string;
  verifyCommand?: string;
}

export interface RegisterResponse {
  status: 'active' | 'pending_verification';
  user?: User;
  token?: string;
  refreshToken?: string;
  verification?: {
    qqGroup: string;
    command: string;
  };
}

// ========== Workload Types ==========

export interface WorkloadItem {
  user: User;
  tasks: {
    role: TaskRole;
    status: TaskStatus;
    count: number;
  }[];
}
