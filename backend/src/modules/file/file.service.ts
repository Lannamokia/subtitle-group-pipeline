import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { env } from "../../config/env";
import crypto from "crypto";
import path from "path";
import type {
  UploadFileInput,
  ReplaceFileInput,
  CreateLinkInput,
  FileQueryInput,
  UpdateUploadPolicyInput,
} from "./file.schema";
import { FileType, TaskRole, UserRole, TimelineEventType } from "@prisma/client";
import * as timelineService from "../timeline/timeline.service";
import {
  DEFAULT_ROLE_UPLOAD_POLICY,
  FONT_EXTENSIONS,
  FONT_MIME_TYPES,
  PACKAGE_EXTENSIONS,
  PACKAGE_MIME_TYPES,
  RELEASE_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  SUBTITLE_MIME_TYPES,
  VIDEO_EXTENSIONS,
  VIDEO_MIME_TYPES,
} from "../../utils/defaultUploadPolicy";
import { normalizeUploadPolicyJson } from "../../utils/uploadPolicy";

// ============ Upload Policy ============

function defaultUploadPolicyRecord() {
  return {
    allowed_types: JSON.stringify(DEFAULT_ROLE_UPLOAD_POLICY),
    max_size_bytes: 104857600,
    require_approval: false,
    extension_whitelist: JSON.stringify(DEFAULT_ROLE_UPLOAD_POLICY.extensionWhitelist),
  };
}

export async function getUploadPolicy(projectId?: string) {
  const resolvedPolicy = resolvePolicyRuleFromCandidates(
    await getUploadPolicyCandidates(projectId),
    undefined,
    "super_admin"
  );

  return resolvedPolicy?.policy || defaultUploadPolicyRecord();
}

export async function updateUploadPolicy(
  data: UpdateUploadPolicyInput,
  projectId?: string
) {
  const normalizedPolicy = normalizeUploadPolicyJson(data.allowed_types, { rejectInvalid: true });
  const extensionWhitelist = data.extension_whitelist === undefined
    ? data.extension_whitelist
    : data.extension_whitelist === null
      ? null
      : JSON.stringify(tryParseStringList(data.extension_whitelist));

  const policy = await prisma.uploadPolicy.create({
    data: {
      project_id: projectId || null,
      allowed_types: normalizedPolicy.json,
      max_size_bytes: data.max_size_bytes,
      require_approval: data.require_approval,
      extension_whitelist: extensionWhitelist,
    },
  });

  return policy;
}

// ============ Upload Validation ============

const BLOCKED_EXTENSIONS = [".exe", ".sh", ".php", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar"];
const BLOCKED_MIME_PATTERNS = [
  /^application\/x-msdownload/,
  /^application\/x-executable/,
  /^application\/x-sh/,
];

type PolicyRule =
  | string[]
  | {
      mime_types?: string[];
      mimeTypes?: string[];
      file_types?: string[];
      fileTypes?: string[];
      extensions?: string[];
      allowed_types?: string[];
      allowedTypes?: string[];
    };

interface NormalizedPolicyRule {
  raw: string[];
  mimeTypes: string[];
  fileTypes: string[];
  extensions: string[];
}

type UploadPolicyRecord = {
  id?: string;
  allowed_types: string;
  max_size_bytes: number;
  require_approval: boolean;
  extension_whitelist?: string | null;
};

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePolicyRule(rule: PolicyRule | unknown): NormalizedPolicyRule {
  if (Array.isArray(rule)) {
    const raw = normalizeStringList(rule);
    return {
      raw,
      mimeTypes: raw.filter((value) => value.includes("/") || value === "*" || value === "*/*"),
      fileTypes: raw.filter((value) => Object.values(FileType).includes(value as FileType)),
      extensions: raw.filter((value) => value.startsWith(".")),
    };
  }

  if (rule && typeof rule === "object") {
    const obj = rule as Record<string, unknown>;
    const raw = [
      ...normalizeStringList(obj.allowed_types),
      ...normalizeStringList(obj.allowedTypes),
    ];
    const mimeTypes = [
      ...normalizeStringList(obj.mime_types),
      ...normalizeStringList(obj.mimeTypes),
    ];
    const fileTypes = [
      ...normalizeStringList(obj.file_types),
      ...normalizeStringList(obj.fileTypes),
    ];
    const extensions = normalizeStringList(obj.extensions);

    return {
      raw: [...raw, ...mimeTypes, ...fileTypes, ...extensions],
      mimeTypes,
      fileTypes,
      extensions,
    };
  }

  return { raw: [], mimeTypes: [], fileTypes: [], extensions: [] };
}

function mergePolicyRules(rules: NormalizedPolicyRule[]): NormalizedPolicyRule {
  const unique = (values: string[]) => Array.from(new Set(values));
  return {
    raw: unique(rules.flatMap((rule) => rule.raw)),
    mimeTypes: unique(rules.flatMap((rule) => rule.mimeTypes)),
    fileTypes: unique(rules.flatMap((rule) => rule.fileTypes)),
    extensions: unique(rules.flatMap((rule) => rule.extensions)),
  };
}

function isPolicyRuleEmpty(rule: NormalizedPolicyRule | null): boolean {
  return !rule || rule.raw.length + rule.mimeTypes.length + rule.fileTypes.length + rule.extensions.length === 0;
}

function tryParseStringList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    return normalizeStringList(JSON.parse(value));
  } catch {
    throw new AppError("Extension whitelist must be valid JSON string array", "VALIDATION_ERROR", 400);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRoleMatrix(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.keys(value).some((key) => Object.values(TaskRole).includes(key as TaskRole));
}

function resolvePolicyMatrix(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (isRoleMatrix(obj.roles)) {
    return obj.roles;
  }

  if (isRoleMatrix(obj.byRole)) {
    return obj.byRole;
  }

  if (isRoleMatrix(obj.allowedTypes)) {
    return obj.allowedTypes;
  }

  if (isRoleMatrix(obj.allowed_types)) {
    return obj.allowed_types;
  }

  if (isRoleMatrix(obj)) {
    return obj;
  }

  return null;
}

function roleRuleFromPolicy(
  policyConfig: unknown,
  role: TaskRole | undefined,
  userRole: UserRole
): NormalizedPolicyRule | null {
  if (Array.isArray(policyConfig)) {
    return normalizePolicyRule(policyConfig);
  }

  if (!policyConfig || typeof policyConfig !== "object") {
    return null;
  }

  const obj = policyConfig as Record<string, unknown>;
  const matrix = resolvePolicyMatrix(obj);

  if (matrix && role && matrix[role]) {
    return normalizePolicyRule(matrix[role]);
  }

  if (matrix && userRole === "supervisor" && matrix.supervisor) {
    return normalizePolicyRule(matrix.supervisor);
  }

  if (matrix && (userRole === "super_admin" || userRole === "group_admin")) {
    return mergePolicyRules(Object.values(matrix).map((rule) => normalizePolicyRule(rule)));
  }

  if (matrix && !role) {
    return mergePolicyRules(Object.values(matrix).map((rule) => normalizePolicyRule(rule)));
  }

  const globalRuleKeys = ["allowed_types", "allowedTypes", "mime_types", "mimeTypes", "file_types", "fileTypes", "extensions"];
  if (globalRuleKeys.some((key) => obj[key] !== undefined)) {
    return normalizePolicyRule(obj);
  }

  return null;
}

async function getUploadPolicyCandidates(projectId?: string): Promise<UploadPolicyRecord[]> {
  const candidates: UploadPolicyRecord[] = [];

  if (projectId) {
    const projectPolicy = await prisma.uploadPolicy.findFirst({
      where: { project_id: projectId },
      orderBy: { created_at: "desc" },
    });

    if (projectPolicy) {
      candidates.push(projectPolicy);
    }
  }

  const globalPolicy = await prisma.uploadPolicy.findFirst({
    where: { project_id: null },
    orderBy: { created_at: "desc" },
  });

  if (globalPolicy && !candidates.some((policy) => policy.id === globalPolicy.id)) {
    candidates.push(globalPolicy);
  }

  candidates.push(defaultUploadPolicyRecord());
  return candidates;
}

function resolvePolicyRuleFromCandidates(
  candidates: UploadPolicyRecord[],
  taskRole: TaskRole | undefined,
  userRole: UserRole
) {
  for (const policy of candidates) {
    const policyConfig = safeJsonParse<unknown>(policy.allowed_types, {});
    const allowedRule = roleRuleFromPolicy(policyConfig, taskRole, userRole);
    if (!isPolicyRuleEmpty(allowedRule)) {
      return { policy, allowedRule: allowedRule!, policyConfig };
    }
  }

  return null;
}

function matchesAllowedType(
  rule: NormalizedPolicyRule,
  mimetype: string,
  ext: string,
  fileType?: FileType
): boolean {
  const allAllowedValues = [...rule.raw, ...rule.mimeTypes, ...rule.fileTypes, ...rule.extensions];
  if (allAllowedValues.includes("*") || allAllowedValues.includes("*/*")) {
    return true;
  }

  const rawContentValues = rule.raw.filter((value) =>
    value.includes("/") || value.startsWith(".")
  );
  const contentValues = [...rawContentValues, ...rule.mimeTypes, ...rule.extensions];
  const mimeMatches = [...rawContentValues, ...rule.mimeTypes].some((allowed) => {
    if (allowed === mimetype) {
      return true;
    }
    if (allowed.endsWith("/*")) {
      return mimetype.startsWith(`${allowed.slice(0, -1)}`);
    }
    return false;
  });

  const fileTypeMatches = fileType
    ? [...rule.raw, ...rule.fileTypes].includes(fileType)
    : false;
  const extensionMatches = ext
    ? [...rawContentValues, ...rule.extensions].includes(ext)
    : false;

  if (contentValues.length > 0) {
    return mimeMatches || extensionMatches;
  }

  return fileTypeMatches;
}

function inferFileTypesFromFile(mimetype: string, ext: string): FileType[] {
  const inferred = new Set<FileType>();

  if (VIDEO_EXTENSIONS.includes(ext) || VIDEO_MIME_TYPES.some((allowed) => (
    allowed.endsWith("/*")
      ? mimetype.startsWith(allowed.slice(0, -1))
      : mimetype === allowed
  ))) {
    inferred.add(FileType.video);
  }

  if (SUBTITLE_EXTENSIONS.includes(ext) || SUBTITLE_MIME_TYPES.some((allowed) => (
    allowed !== "application/octet-stream" && mimetype === allowed
  ))) {
    inferred.add(FileType.subtitle);
  }

  if (FONT_EXTENSIONS.includes(ext) || FONT_MIME_TYPES.some((allowed) => (
    allowed !== "application/octet-stream" && (
      allowed.endsWith("/*")
        ? mimetype.startsWith(allowed.slice(0, -1))
        : mimetype === allowed
    )
  ))) {
    inferred.add(FileType.font);
  }

  if (PACKAGE_EXTENSIONS.includes(ext) || PACKAGE_MIME_TYPES.some((allowed) => (
    allowed !== "application/octet-stream" && mimetype === allowed
  ))) {
    inferred.add(FileType.project_package);
  }

  if (RELEASE_EXTENSIONS.includes(ext)) {
    inferred.add(FileType.other);
  }

  return Array.from(inferred);
}

function validateDeclaredFileType(
  fileType: FileType | undefined,
  mimetype: string,
  ext: string
): ValidationResult {
  if (!fileType) {
    return { valid: true };
  }

  const inferredTypes = inferFileTypesFromFile(mimetype, ext);
  if (inferredTypes.length > 0 && !inferredTypes.includes(fileType)) {
    return {
      valid: false,
      error: `Declared file type ${fileType} does not match file extension or MIME type. Detected: ${inferredTypes.join(", ")}`,
    };
  }

  return { valid: true };
}

async function resolveUploadRole(
  projectId: string,
  userRole: UserRole,
  userId?: string,
  explicitRole?: TaskRole
): Promise<TaskRole | undefined> {
  if (explicitRole) {
    return explicitRole;
  }

  if (userId) {
    const membership = await prisma.projectMember.findFirst({
      where: {
        project_id: projectId,
        user_id: userId,
        left_at: null,
      },
      orderBy: { joined_at: "desc" },
    });

    if (membership) {
      return membership.role;
    }
  }

  if (userRole === "supervisor") {
    return "supervisor";
  }

  return undefined;
}

function parseMetadata(metadata: string | null | undefined): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(metadata, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

const TASK_ROLE_FILE_LABELS: Record<TaskRole, string> = {
  source: "片源",
  timing: "时轴",
  translation: "翻译",
  post_production: "后期",
  encoding: "压制",
  release: "发布",
  supervisor: "监制",
};

const DEFAULT_EXTENSION_BY_FILE_TYPE: Record<FileType, string> = {
  video: ".mp4",
  subtitle: ".ass",
  font: ".ttf",
  project_package: ".zip",
  other: ".bin",
};

interface TaskUploadContext {
  taskId?: string;
  unitId?: string;
  role?: TaskRole;
  taskTitle?: string;
}

interface TaskContextData {
  task_id?: string;
  taskId?: string;
  unit_id?: string;
  unitId?: string;
  role?: TaskRole;
}

function isTaskRole(value: unknown): value is TaskRole {
  return typeof value === "string" && Object.values(TaskRole).includes(value as TaskRole);
}

function getUploadExtension(filename: string, fileType: FileType): string {
  const ext = path.extname(filename).toLowerCase();
  return ext || DEFAULT_EXTENSION_BY_FILE_TYPE[fileType];
}

function normalizeFilenameSegment(value: string | null | undefined, fallback: string): string {
  const sanitized = sanitizeFilename((value || fallback).trim());
  const withoutExt = sanitized.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/\s+/g, "_") || fallback;
}

function buildDisplayFilename(data: UploadFileInput, context: TaskUploadContext): string {
  if (!context.taskId || !context.role) {
    return sanitizeFilename(data.name);
  }

  const roleLabel = TASK_ROLE_FILE_LABELS[context.role] || context.role;
  const taskName = normalizeFilenameSegment(context.taskTitle, "任务");
  const ext = getUploadExtension(data.name, data.file_type);
  return sanitizeFilename(`${roleLabel}_${taskName}${ext}`);
}

async function resolveTaskUploadContext(
  projectId: string,
  data: TaskContextData
): Promise<TaskUploadContext> {
  const taskId = data.task_id || data.taskId;
  const providedUnitId = data.unit_id || data.unitId;

  if (!taskId) {
    return {
      unitId: providedUnitId,
      role: data.role,
    };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      project_id: true,
      unit_id: true,
      title: true,
      role: true,
    },
  });

  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }

  if (task.project_id !== projectId) {
    throw new AppError("Task does not belong to this project", "VALIDATION_ERROR", 400);
  }

  if (data.role && data.role !== task.role) {
    throw new AppError("Upload role does not match task role", "VALIDATION_ERROR", 400);
  }

  if (providedUnitId && task.unit_id && providedUnitId !== task.unit_id) {
    throw new AppError("Upload unit does not match task unit", "VALIDATION_ERROR", 400);
  }

  return {
    taskId: task.id,
    unitId: providedUnitId || task.unit_id || undefined,
    role: task.role,
    taskTitle: task.title,
  };
}

function metadataStringForUpload(
  data: UploadFileInput,
  context: TaskUploadContext = {}
): string | null | undefined {
  const metadata = parseMetadata(data.metadata);
  const taskId = context.taskId || data.task_id || data.taskId;
  const unitId = context.unitId || data.unit_id || data.unitId;
  const role = context.role || data.role;

  if (taskId) {
    metadata.task_id = taskId;
  }
  if (unitId) {
    metadata.unit_id = unitId;
  }
  if (role) {
    metadata.role = role;
  }

  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : data.metadata;
}

function sourceEpisodeLengthFromInput(data: {
  episode_length?: number | null;
  episodeLength?: number | null;
}): number | null | undefined {
  return data.episode_length ?? data.episodeLength;
}

async function syncSourceEpisodeLength(
  projectId: string,
  context: TaskUploadContext,
  episodeLength: number | null | undefined
) {
  if (context.role !== TaskRole.source || !context.unitId || episodeLength === undefined || episodeLength === null) {
    return;
  }

  const unit = await prisma.projectUnit.findUnique({
    where: { id: context.unitId },
    select: { project_id: true },
  });

  if (!unit || unit.project_id !== projectId) {
    throw new AppError("Project unit not found", "NOT_FOUND", 404);
  }

  await prisma.projectUnit.update({
    where: { id: context.unitId },
    data: { episode_length: episodeLength },
  });
}

function getMetadataStringValue(metadata: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return undefined;
}

function parseTagList(tags: string | null | undefined): string[] {
  if (!tags) {
    return [];
  }

  const parsed = safeJsonParse<unknown>(tags, null);
  if (Array.isArray(parsed)) {
    return normalizeStringList(parsed);
  }

  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function requestedTags(query: FileQueryInput): string[] {
  return [
    ...(query.tag ? [query.tag] : []),
    ...(query.tags ? query.tags.split(",") : []),
  ]
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export async function validateUpload(
  file: {
    originalname: string;
    mimetype: string;
    size: number;
  },
  projectId: string,
  userRole: UserRole,
  options: {
    userId?: string;
    taskRole?: TaskRole;
    fileType?: FileType;
  } = {}
): Promise<ValidationResult> {
  // Check blocked extensions (security)
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `Executable files (${ext}) are not allowed` };
  }

  // Check blocked MIME patterns
  for (const pattern of BLOCKED_MIME_PATTERNS) {
    if (pattern.test(file.mimetype)) {
      return { valid: false, error: "Executable file types are not allowed" };
    }
  }

  const declaredTypeValidation = validateDeclaredFileType(options.fileType, file.mimetype, ext);
  if (!declaredTypeValidation.valid) {
    return declaredTypeValidation;
  }

  const taskRole = await resolveUploadRole(
    projectId,
    userRole,
    options.userId,
    options.taskRole
  );
  const resolvedPolicy = resolvePolicyRuleFromCandidates(
    await getUploadPolicyCandidates(projectId),
    taskRole,
    userRole
  );

  if (!resolvedPolicy) {
    return {
      valid: false,
      error: taskRole
        ? `No upload policy is configured for role ${taskRole}`
        : "No upload policy is configured for the uploader role",
    };
  }
  const { policy, allowedRule } = resolvedPolicy;
  const maxSize = policy.max_size_bytes;
  const whitelist = policy.extension_whitelist
    ? tryParseStringList(policy.extension_whitelist)
    : null;

  // Check MIME/file asset type against global or role-specific policy
  if (!matchesAllowedType(allowedRule, file.mimetype, ext, options.fileType)) {
    const allowed = [
      ...allowedRule.raw,
      ...allowedRule.mimeTypes,
      ...allowedRule.fileTypes,
      ...allowedRule.extensions,
    ];
    return {
      valid: false,
      error: `File type ${file.mimetype}${options.fileType ? `/${options.fileType}` : ""} is not allowed for ${taskRole || userRole}. Allowed: ${Array.from(new Set(allowed)).join(", ")}`,
    };
  }

  // Check extension whitelist
  if (whitelist && whitelist.length > 0 && !whitelist.includes(ext)) {
    return {
      valid: false,
      error: `File extension ${ext} is not allowed. Allowed: ${whitelist.join(", ")}`,
    };
  }

  // Check global max size from env
  if (file.size > env.UPLOAD_MAX_SIZE) {
    return {
      valid: false,
      error: `File size exceeds global maximum of ${env.UPLOAD_MAX_SIZE} bytes`,
    };
  }

  // Check project/policy size limit after the system-wide cap
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size ${file.size} exceeds maximum allowed ${maxSize} bytes`,
    };
  }

  return { valid: true };
}

// ============ Filename Sanitization ============

export function sanitizeFilename(filename: string): string {
  // Remove path traversal characters
  const basename = path.basename(filename);
  // Remove control characters and dangerous chars
  return basename.replace(/[<>:"|?*\x00-\x1f]/g, "_").trim();
}

async function findTaskFileBucket(
  projectId: string,
  fileType: FileType,
  context: TaskUploadContext
) {
  if (!context.taskId || !context.role) {
    return null;
  }

  const candidates = await prisma.fileEntity.findMany({
    where: {
      project_id: projectId,
      file_type: fileType,
      is_deleted: false,
    },
    include: {
      versions: {
        orderBy: { version_number: "desc" },
        take: 1,
      },
    },
  });

  return candidates
    .filter((file) => {
      const metadata = parseMetadata(file.metadata);
      const taskId = getMetadataStringValue(metadata, "task_id", "taskId");
      const role = getMetadataStringValue(metadata, "role", "task_role");
      return taskId === context.taskId && role === context.role;
    })
    .sort((a, b) => {
      const aDate = a.versions[0]?.created_at ?? a.created_at;
      const bDate = b.versions[0]?.created_at ?? b.created_at;
      return bDate.getTime() - aDate.getTime();
    })[0] || null;
}

async function appendFileVersion(
  fileId: string,
  uploaderId: string,
  data: ReplaceFileInput,
  options: {
    displayName?: string;
    metadata?: string | null;
    tags?: string | null;
    storageBackendId?: string | null;
    taskId?: string;
  } = {}
) {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      versions: {
        orderBy: { version_number: "desc" },
        take: 1,
      },
    },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  if (file.is_deleted) {
    throw new AppError("Cannot replace a deleted file", "BAD_REQUEST", 400);
  }

  const latestVersion = file.versions[0];
  const nextVersionNumber = (latestVersion?.version_number || 0) + 1;
  const displayName = options.displayName || file.name;
  const metadata = options.metadata ?? data.metadata ?? file.metadata;
  const tags = options.tags ?? data.tags ?? file.tags;
  const storageBackendId = options.storageBackendId ?? data.storage_backend_id ?? file.storage_backend_id;

  await prisma.fileVersion.updateMany({
    where: { file_id: fileId },
    data: { is_latest: false },
  });

  const version = await prisma.fileVersion.create({
    data: {
      file_id: fileId,
      version_number: nextVersionNumber,
      storage_path: data.storage_path,
      size_bytes: data.size_bytes,
      checksum: data.checksum,
      change_summary: data.change_summary || `Version ${nextVersionNumber}`,
      is_current: true,
      is_latest: true,
      is_latest_approved: false,
    },
  });

  const updatedFile = await prisma.fileEntity.update({
    where: { id: fileId },
    data: {
      name: displayName,
      original_name: displayName,
      mime_type: data.mime_type,
      size_bytes: data.size_bytes,
      storage_path: data.storage_path,
      storage_backend_id: storageBackendId,
      checksum: data.checksum,
      metadata,
      tags,
    },
    include: {
      uploader: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  await resolveCurrentVersion(fileId);
  const currentVersion = await prisma.fileVersion.findFirst({
    where: { file_id: fileId, is_current: true },
  });

  await timelineService.createTimelineEvent({
    project_id: file.project_id,
    event_type: TimelineEventType.file_uploaded,
    title: "文件已上传新版本",
    description: `文件「${updatedFile.name}」已上传新版本`,
    actor_id: uploaderId,
    metadata: {
      file_id: fileId,
      version_id: version.id,
      version_number: version.version_number,
      task_id: options.taskId,
    },
  });

  return {
    ...updatedFile,
    current_version: currentVersion || version,
    latest_version: version,
  };
}

// ============ File Upload ============

export async function uploadFile(
  uploaderId: string,
  data: UploadFileInput
) {
  // Validate project exists
  const project = await prisma.project.findUnique({
    where: { id: data.project_id },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  const uploader = await prisma.user.findUnique({
    where: { id: uploaderId },
    select: { role: true },
  });

  if (!uploader) {
    throw new AppError("Uploader not found", "NOT_FOUND", 404);
  }

  const taskContext = await resolveTaskUploadContext(data.project_id, data);

  const uploadValidation = await validateUpload(
    {
      originalname: data.name,
      mimetype: data.mime_type,
      size: data.size_bytes,
    },
    data.project_id,
    uploader.role,
    {
      userId: uploaderId,
      taskRole: taskContext.role,
      fileType: data.file_type,
    }
  );

  if (!uploadValidation.valid) {
    throw new AppError(uploadValidation.error || "Invalid upload", "VALIDATION_ERROR", 400);
  }

  // Determine storage backend
  const storageBackendId = data.storage_backend_id || project.storage_backend_id;

  const displayName = buildDisplayFilename(data, taskContext);
  const metadata = metadataStringForUpload(data, taskContext);
  const existingTaskFile = await findTaskFileBucket(
    data.project_id,
    data.file_type,
    taskContext
  );

  if (existingTaskFile) {
    const updatedFile = await appendFileVersion(existingTaskFile.id, uploaderId, data, {
      displayName,
      metadata,
      tags: data.tags,
      storageBackendId,
      taskId: taskContext.taskId,
    });
    await syncSourceEpisodeLength(data.project_id, taskContext, sourceEpisodeLengthFromInput(data));
    return updatedFile;
  }

  // Create file entity
  const file = await prisma.fileEntity.create({
    data: {
      project_id: data.project_id,
      uploader_id: uploaderId,
      name: displayName,
      original_name: taskContext.taskId ? displayName : data.name,
      file_type: data.file_type,
      mime_type: data.mime_type,
      size_bytes: data.size_bytes,
      storage_path: data.storage_path,
      storage_backend_id: storageBackendId,
      checksum: data.checksum,
      metadata,
      tags: data.tags,
    },
    include: {
      uploader: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  // Create initial version (version 1)
  const version = await prisma.fileVersion.create({
    data: {
      file_id: file.id,
      version_number: 1,
      storage_path: data.storage_path,
      size_bytes: data.size_bytes,
      checksum: data.checksum,
      change_summary: data.change_summary || "Initial upload",
      is_current: true,
      is_latest: true,
      is_latest_approved: false,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: data.project_id,
    event_type: TimelineEventType.file_uploaded,
    title: "文件已上传",
    description: `文件「${file.name}」已上传`,
    actor_id: uploaderId,
    metadata: {
      file_id: file.id,
      version_id: version.id,
      file_type: file.file_type,
      task_id: taskContext.taskId,
    },
  });

  await syncSourceEpisodeLength(data.project_id, taskContext, sourceEpisodeLengthFromInput(data));

  return {
    ...file,
    current_version: version,
    latest_version: version,
  };
}

export async function createFile(uploaderId: string, data: UploadFileInput) {
  return uploadFile(uploaderId, data);
}

// ============ Replace File (explicit replace) ============

export async function replaceFile(
  fileId: string,
  uploaderId: string,
  data: ReplaceFileInput
) {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      versions: {
        orderBy: { version_number: "desc" },
        take: 1,
      },
    },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  if (file.is_deleted) {
    throw new AppError("Cannot replace a deleted file", "BAD_REQUEST", 400);
  }

  const uploader = await prisma.user.findUnique({
    where: { id: uploaderId },
    select: { role: true },
  });
  if (!uploader) {
    throw new AppError("Uploader not found", "NOT_FOUND", 404);
  }

  const metadata = parseMetadata(data.metadata ?? file.metadata);
  const metadataRole = getMetadataStringValue(metadata, "role", "task_role");
  const validation = await validateUpload(
    {
      originalname: data.name || file.name,
      mimetype: data.mime_type,
      size: data.size_bytes,
    },
    file.project_id,
    uploader.role,
    {
      userId: uploaderId,
      taskRole: metadataRole && Object.values(TaskRole).includes(metadataRole as TaskRole)
        ? metadataRole as TaskRole
        : undefined,
      fileType: file.file_type,
    }
  );

  if (!validation.valid) {
    throw new AppError(validation.error || "Invalid upload", "VALIDATION_ERROR", 400);
  }

  // Determine storage backend
  const storageBackendId = data.storage_backend_id || file.storage_backend_id;

  const taskContext: TaskUploadContext = {
    taskId: getMetadataStringValue(metadata, "task_id", "taskId"),
    unitId: getMetadataStringValue(metadata, "unit_id", "unitId"),
    role: isTaskRole(metadataRole) ? metadataRole : undefined,
  };
  if (taskContext.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: taskContext.taskId },
      select: { title: true, role: true },
    });
    if (task) {
      taskContext.taskTitle = task.title;
      taskContext.role = taskContext.role || task.role;
    }
  }

  const requestedName = data.name || file.name;
  const displayName = taskContext.taskId && taskContext.role
    ? buildDisplayFilename(
        {
          project_id: file.project_id,
          name: requestedName,
          file_type: file.file_type,
          mime_type: data.mime_type,
          size_bytes: data.size_bytes,
          storage_path: data.storage_path,
          storage_backend_id: storageBackendId,
          checksum: data.checksum,
          metadata: data.metadata,
          tags: data.tags,
          task_id: taskContext.taskId,
          unit_id: taskContext.unitId,
          role: taskContext.role,
          change_summary: data.change_summary,
        },
        taskContext
      )
    : sanitizeFilename(requestedName);

  return appendFileVersion(fileId, uploaderId, data, {
    displayName,
    metadata: data.metadata ?? file.metadata,
    tags: data.tags ?? file.tags,
    storageBackendId,
    taskId: taskContext.taskId,
  });
}

// ============ Version Auto-Resolution ============

export async function resolveCurrentVersion(fileId: string): Promise<void> {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      versions: {
        orderBy: { version_number: "desc" },
      },
    },
  });

  if (!file || file.versions.length === 0) return;

  // Find latest approved version
  const latestApproved = file.versions.find((v) => v.is_latest_approved);
  const latest = file.versions.find((v) => v.is_latest);

  // current_version = latest_approved if exists, else latest
  const targetVersion = latestApproved || latest;

  if (targetVersion) {
    // Unset current on all versions
    await prisma.fileVersion.updateMany({
      where: { file_id: fileId },
      data: { is_current: false },
    });

    // Set current on target
    await prisma.fileVersion.update({
      where: { id: targetVersion.id },
      data: { is_current: true },
    });
  }
}

// ============ Get Project Files ============

export async function getProjectFiles(
  projectId: string,
  query: FileQueryInput
) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const resolvedProjectId = projectId || query.project_id || query.projectId;
  const resolvedFileType = query.file_type || query.type;
  const resolvedUnitId = query.unit_id || query.unitId;
  const resolvedTaskId = query.task_id || query.taskId;
  const resolvedUploaderId = query.uploader_id || query.uploaderId;
  const uploadedFrom = query.uploaded_from || query.uploadedFrom;
  const uploadedTo = query.uploaded_to || query.uploadedTo;
  const tagFilters = requestedTags(query);

  const where: Record<string, unknown> = {};

  if (resolvedProjectId) {
    where.project_id = resolvedProjectId;
  }

  if (!query.include_deleted) {
    where.is_deleted = false;
  }

  if (resolvedFileType) {
    where.file_type = resolvedFileType;
  }

  if (resolvedUploaderId) {
    where.uploader_id = resolvedUploaderId;
  }

  if (uploadedFrom || uploadedTo) {
    where.created_at = {
      ...(uploadedFrom ? { gte: new Date(uploadedFrom) } : {}),
      ...(uploadedTo ? { lte: new Date(uploadedTo) } : {}),
    };
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { original_name: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const files = await prisma.fileEntity.findMany({
    where,
    orderBy: { created_at: "desc" },
    include: {
      uploader: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      versions: {
        orderBy: { version_number: "desc" },
        take: 5,
      },
      _count: {
        select: { versions: true },
      },
    },
  });

  const decorateFile = (file: typeof files[number]) => {
    const metadata = parseMetadata(file.metadata);
    const fileTags = parseTagList(file.tags);
    const currentVersion =
      file.versions.find((version) => version.is_current) ||
      file.versions.find((version) => version.is_latest_approved) ||
      file.versions.find((version) => version.is_latest) ||
      file.versions[0] ||
      null;

    return {
      ...file,
      metadata_json: metadata,
      tag_list: fileTags,
      task_id: getMetadataStringValue(metadata, "task_id", "taskId"),
      unit_id: getMetadataStringValue(metadata, "unit_id", "unitId"),
      role: getMetadataStringValue(metadata, "role", "task_role"),
      current_version: currentVersion,
      version_count: file._count.versions,
      has_multiple_versions: file._count.versions > 1,
      latest_update_at: file.versions[0]?.created_at || file.created_at,
    };
  };

  const decoratedFiles = files.map(decorateFile).filter((file) => {
    if (getMetadataStringValue(file.metadata_json, "asset_kind", "assetKind") === "link") {
      return false;
    }
    if (resolvedUnitId && file.unit_id !== resolvedUnitId) {
      return false;
    }
    if (resolvedTaskId && file.task_id !== resolvedTaskId) {
      return false;
    }
    if (query.role && file.role !== query.role) {
      return false;
    }
    if (tagFilters.length > 0 && !tagFilters.every((tag) => file.tag_list.includes(tag))) {
      return false;
    }
    return true;
  });

  const linkWhere: Record<string, unknown> = {};
  if (resolvedProjectId) {
    linkWhere.project_id = resolvedProjectId;
  }
  if (uploadedFrom || uploadedTo) {
    linkWhere.created_at = {
      ...(uploadedFrom ? { gte: new Date(uploadedFrom) } : {}),
      ...(uploadedTo ? { lte: new Date(uploadedTo) } : {}),
    };
  }

  const linkHistory = await prisma.linkHistory.findMany({
    where: linkWhere,
    orderBy: { created_at: "desc" },
    include: {
      file: {
        select: {
          id: true,
          name: true,
          file_type: true,
          metadata: true,
          tags: true,
        },
      },
    },
  });

  const creatorIds = Array.from(new Set(linkHistory.map((link) => link.created_by)));
  const creators = creatorIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, username: true, nickname: true },
      })
    : [];
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));

  const decoratedLinks = linkHistory.map((link) => {
    const metadata = parseMetadata(link.file?.metadata);
    const linkTags = parseTagList(link.file?.tags);
    return {
      ...link,
      asset_kind: "link" as const,
      name: link.description || link.file?.name || link.url,
      extract_code: getMetadataStringValue(metadata, "extract_code", "extractCode"),
      file_type: link.file?.file_type || FileType.other,
      uploader_id: link.created_by,
      uploader: creatorMap.get(link.created_by) || null,
      metadata_json: metadata,
      tag_list: linkTags,
      task_id: getMetadataStringValue(metadata, "task_id", "taskId"),
      unit_id: getMetadataStringValue(metadata, "unit_id", "unitId"),
      role: getMetadataStringValue(metadata, "role", "task_role"),
      current_version: null,
      version_count: 1,
      has_multiple_versions: false,
      latest_update_at: link.created_at,
    };
  }).filter((link) => {
    if (resolvedFileType && link.file_type !== resolvedFileType) {
      return false;
    }
    if (resolvedUploaderId && link.created_by !== resolvedUploaderId) {
      return false;
    }
    if (resolvedUnitId && link.unit_id !== resolvedUnitId) {
      return false;
    }
    if (resolvedTaskId && link.task_id !== resolvedTaskId) {
      return false;
    }
    if (query.role && link.role !== query.role) {
      return false;
    }
    if (tagFilters.length > 0 && !tagFilters.every((tag) => link.tag_list.includes(tag))) {
      return false;
    }
    if (query.search) {
      const needle = query.search.toLowerCase();
      const haystack = [
        link.name,
        link.url,
        link.link_type,
        link.file?.name,
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    }
    return true;
  });

  const groupedLinks = Array.from(
    decoratedLinks.reduce((groups, link) => {
      const key = link.file_id || link.id;
      const history = groups.get(key) || [];
      history.push(link);
      groups.set(key, history);
      return groups;
    }, new Map<string, typeof decoratedLinks>())
      .values()
  ).map((history) => {
    const sortedHistory = [...history].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    const latest = sortedHistory[0];
    return {
      ...latest,
      link_history: sortedHistory,
      version_count: sortedHistory.length,
      has_multiple_versions: sortedHistory.length > 1,
      latest_update_at: latest.created_at,
    };
  });

  const binaryItems = decoratedFiles.map((file) => ({
    ...file,
    asset_kind: "binary" as const,
  }));
  const items = [...binaryItems, ...groupedLinks]
    .sort((a, b) => b.latest_update_at.getTime() - a.latest_update_at.getTime());
  const pagedItems = items.slice(skip, skip + pageSize);
  const itemIds = new Set(pagedItems.map((item) => `${item.asset_kind}:${item.id}`));

  return {
    files: binaryItems.filter((file) => itemIds.has(`binary:${file.id}`)),
    links: groupedLinks.filter((link) => itemIds.has(`link:${link.id}`)),
    items: pagedItems,
    meta: {
      page,
      pageSize,
      total: items.length,
      totalPages: Math.ceil(items.length / pageSize),
    },
  };
}

// ============ Get File By ID ============

export async function getFileById(fileId: string) {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      uploader: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      versions: {
        orderBy: { version_number: "desc" },
      },
      link_history: {
        orderBy: { created_at: "desc" },
      },
      _count: {
        select: { versions: true },
      },
    },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  const metadata = parseMetadata(file.metadata);
  const currentVersion =
    file.versions.find((version) => version.is_current) ||
    file.versions.find((version) => version.is_latest_approved) ||
    file.versions.find((version) => version.is_latest) ||
    file.versions[0] ||
    null;
  const comments = await prisma.comment.findMany({
    where: {
      deleted_at: null,
      file_version: { file_id: fileId },
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      file_version: true,
    },
    orderBy: { created_at: "asc" },
  });

  return {
    ...file,
    comments,
    metadata_json: metadata,
    tag_list: parseTagList(file.tags),
    task_id: getMetadataStringValue(metadata, "task_id", "taskId"),
    unit_id: getMetadataStringValue(metadata, "unit_id", "unitId"),
    role: getMetadataStringValue(metadata, "role", "task_role"),
    current_version: currentVersion,
    version_count: file._count.versions,
    has_multiple_versions: file._count.versions > 1,
    latest_update_at: file.versions[0]?.created_at || file.created_at,
  };
}

// ============ Get File Versions ============

export async function getFileVersions(fileId: string) {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  const versions = await prisma.fileVersion.findMany({
    where: { file_id: fileId },
    orderBy: { version_number: "desc" },
  });

  return versions;
}

// ============ Approve Version ============

export async function approveVersion(
  fileId: string,
  versionId: string,
  approverId: string
) {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      versions: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  const version = file.versions.find((v) => v.id === versionId);
  if (!version) {
    throw new AppError("Version not found", "NOT_FOUND", 404);
  }

  // Unset latest_approved on all versions of this file
  await prisma.fileVersion.updateMany({
    where: { file_id: fileId },
    data: { is_latest_approved: false },
  });

  // Mark this version as approved
  const updatedVersion = await prisma.fileVersion.update({
    where: { id: versionId },
    data: {
      is_latest_approved: true,
      approved_by: approverId,
      approved_at: new Date(),
    },
  });

  // Auto-resolve current_version
  await resolveCurrentVersion(fileId);

  return updatedVersion;
}

// ============ Delete File (soft delete) ============

export async function deleteFile(fileId: string, deletedBy: string) {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      project: {
        select: { owner_id: true },
      },
    },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  if (file.is_deleted) {
    throw new AppError("File is already deleted", "BAD_REQUEST", 400);
  }

  const actor = await prisma.user.findUnique({
    where: { id: deletedBy },
    select: { role: true },
  });

  if (!actor) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  const isPrivilegedRole = ["super_admin", "group_admin", "supervisor"].includes(actor.role);
  const isUploader = file.uploader_id === deletedBy;
  const isProjectOwner = file.project.owner_id === deletedBy;
  const membership = await prisma.projectMember.findFirst({
    where: {
      project_id: file.project_id,
      user_id: deletedBy,
      left_at: null,
      OR: [{ role: "supervisor" }, { is_lead: true }],
    },
    select: { id: true },
  });

  if (!isPrivilegedRole && !isUploader && !isProjectOwner && !membership) {
    throw new AppError("Insufficient permissions to delete this file", "FORBIDDEN", 403);
  }

  await prisma.$transaction([
    prisma.fileEntity.update({
      where: { id: fileId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: deletedBy,
      },
    }),
    prisma.downloadLink.updateMany({
      where: {
        file_id: fileId,
        is_active: true,
      },
      data: { is_active: false },
    }),
  ]);

  return { success: true };
}

// ============ Download Link ============

function generateToken(versionId?: string): string {
  const random = crypto.randomBytes(32).toString("hex");
  return versionId ? `fv_${versionId}_${random}` : random;
}

export function getVersionIdFromDownloadToken(token: string): string | undefined {
  const match = token.match(/^fv_([0-9a-fA-F-]{36})_[0-9a-f]+$/);
  return match?.[1];
}

function getMinimumTtl(fileType: string, requestedTtl: number): number {
  const baseMinimum = 90; // 90 seconds minimum
  const videoMinimum = 60; // 60 seconds for video (as per spec, but minimum is 90)

  if (fileType === "video") {
    return Math.max(requestedTtl, videoMinimum, baseMinimum);
  }
  return Math.max(requestedTtl, baseMinimum);
}

async function resolveConfiguredDownloadTtl(
  project: { download_link_ttl_seconds?: number | null },
  requestedTtl: number
): Promise<number> {
  if (project.download_link_ttl_seconds) {
    return project.download_link_ttl_seconds;
  }

  const settings = await prisma.dataRetentionSettings.findFirst({
    orderBy: { created_at: "desc" },
    select: { download_link_ttl_seconds: true },
  });

  return settings?.download_link_ttl_seconds || requestedTtl;
}

async function assertFileViewPermission(file: {
  project_id: string;
  uploader_id: string;
  project: { owner_id: string };
}, userId: string, userRole: UserRole): Promise<void> {
  if (["super_admin", "group_admin", "supervisor"].includes(userRole)) {
    return;
  }

  if (file.uploader_id === userId || file.project.owner_id === userId) {
    return;
  }

  const membership = await prisma.projectMember.findFirst({
    where: {
      project_id: file.project_id,
      user_id: userId,
      left_at: null,
    },
    select: { id: true },
  });

  if (!membership) {
    throw new AppError("Insufficient permissions to view this file", "FORBIDDEN", 403);
  }
}

export async function getDownloadLink(
  fileId: string,
  userId: string,
  userRole: UserRole,
  requestedTtl: number = 300,
  versionId?: string
): Promise<{ downloadUrl: string; url: string; expiresAt: Date }> {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      project: {
        include: {
          storage_backend: true,
        },
      },
      versions: {
        where: versionId ? { id: versionId } : { is_current: true },
        take: 1,
      },
    },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  if (file.is_deleted) {
    throw new AppError("File has been deleted", "GONE", 410);
  }

  await assertFileViewPermission(file, userId, userRole);

  // Check sensitive file access
  const tags: string[] = file.tags ? JSON.parse(file.tags) : [];
  const isSensitive = tags.includes("sensitive");
  if (isSensitive) {
    // Only source, encoding, supervisor roles can download sensitive files
    const allowedRoles: UserRole[] = ["super_admin", "group_admin", "supervisor"];
    // Also check project membership for source/encoding roles
    const membership = await prisma.projectMember.findFirst({
      where: {
        project_id: file.project_id,
        user_id: userId,
      },
    });

    const memberRole = membership?.role as TaskRole | undefined;
    const sensitiveAllowedRoles: TaskRole[] = ["source", "encoding", "supervisor"];

    const hasSensitiveAccess =
      allowedRoles.includes(userRole) ||
      (memberRole !== undefined && sensitiveAllowedRoles.includes(memberRole));

    if (!hasSensitiveAccess) {
      throw new AppError(
        "Insufficient permissions to download sensitive files",
        "FORBIDDEN",
        403
      );
    }
  }

  const targetVersion = file.versions[0];
  if (!targetVersion) {
    throw new AppError(
      versionId ? "File version not found" : "No current version available",
      "NOT_FOUND",
      404
    );
  }

  // Calculate TTL
  const configuredTtl = await resolveConfiguredDownloadTtl(file.project, requestedTtl);
  const ttlSeconds = getMinimumTtl(file.file_type, configuredTtl);
  const now = new Date();
  const nextSecond = Math.ceil(now.getTime() / 1000) * 1000;
  const expiresAt = new Date(nextSecond + ttlSeconds * 1000);

  if (!versionId) {
    // Check for existing non-expired link for same user+file.
    const existingLink = await prisma.downloadLink.findFirst({
      where: {
        file_id: fileId,
        created_by: userId,
        is_active: true,
        expires_at: { gt: new Date(now.getTime() + 30 * 1000) },
        token: { not: { startsWith: "fv_" } },
      },
      orderBy: { created_at: "desc" },
    });

    if (existingLink) {
      const reuseThreshold = file.file_type === "video" ? 60 * 1000 : 30 * 1000;
      const timeUntilExpiry = existingLink.expires_at.getTime() - now.getTime();

      if (timeUntilExpiry > reuseThreshold) {
        return {
          downloadUrl: `${env.API_PREFIX}/download/${existingLink.token}`,
          url: `${env.API_PREFIX}/download/${existingLink.token}`,
          expiresAt: existingLink.expires_at,
        };
      }
    }
  }

  // Determine storage backend
  let backend = file.project.storage_backend;
  if (file.storage_backend_id && file.storage_backend_id !== backend?.id) {
    backend = await prisma.storageBackend.findUnique({
      where: { id: file.storage_backend_id },
    });
  }
  const storageBackendId = file.storage_backend_id || backend?.id;

  let downloadUrl: string;
  const token = generateToken(versionId);

  if (backend?.backend_type === "s3" || backend?.backend_type === "s3_compatible") {
    // For S3, generate presigned URL
    const { getS3Config } = await import("../storage/storage.service");
    const { S3Adapter } = await import("../storage/adapters/s3.adapter");
    const config = getS3Config(backend.config);
    const s3Adapter = new S3Adapter(config);
    downloadUrl = await s3Adapter.getPresignedUrl(
      targetVersion.storage_path,
      ttlSeconds
    );

    await prisma.downloadLink.create({
      data: {
        project_id: file.project_id,
        file_id: fileId,
        created_by: userId,
        token,
        expires_at: expiresAt,
        max_downloads: null,
        download_count: 0,
        is_active: true,
      },
    });
  } else {
    // For local storage, create a DownloadLink record with token
    await prisma.downloadLink.create({
      data: {
        project_id: file.project_id,
        file_id: fileId,
        created_by: userId,
        token,
        expires_at: expiresAt,
        max_downloads: null,
        download_count: 0,
        is_active: true,
      },
    });
    downloadUrl = `${env.API_PREFIX}/download/${token}`;
  }

  return {
    downloadUrl,
    url: downloadUrl,
    expiresAt,
  };
}

// ============ Verify and Serve Download Token ============

export async function verifyDownloadToken(token: string) {
  const link = await prisma.downloadLink.findUnique({
    where: { token },
  });

  if (!link) {
    throw new AppError("Invalid download token", "NOT_FOUND", 404);
  }

  if (!link.is_active) {
    throw new AppError("Download link is inactive", "GONE", 410);
  }

  if (link.expires_at < new Date()) {
    throw new AppError("Download link has expired", "GONE", 410);
  }

  if (link.max_downloads !== null && link.download_count >= link.max_downloads) {
    throw new AppError("Download limit exceeded", "GONE", 410);
  }

  if (link.file_id) {
    const file = await prisma.fileEntity.findUnique({
      where: { id: link.file_id },
      select: { is_deleted: true },
    });

    if (!file || file.is_deleted) {
      throw new AppError("File has been deleted", "GONE", 410);
    }
  }

  // Increment download count
  await prisma.downloadLink.update({
    where: { id: link.id },
    data: { download_count: { increment: 1 } },
  });

  return link;
}

// ============ Link Asset (LinkHistory) ============

function tagsStringForLink(data: CreateLinkInput): string | null {
  if (Array.isArray(data.tags)) {
    const tags = normalizeStringList(data.tags);
    return tags.length > 0 ? JSON.stringify(tags) : null;
  }
  if (typeof data.tags === "string" && data.tags.trim()) {
    const tags = parseTagList(data.tags);
    return tags.length > 0 ? JSON.stringify(tags) : null;
  }
  return null;
}

function metadataStringForLink(data: CreateLinkInput, context: TaskUploadContext): string {
  const metadata: Record<string, unknown> = {
    asset_kind: "link",
  };

  if (context.taskId) metadata.task_id = context.taskId;
  if (context.unitId) metadata.unit_id = context.unitId;
  if (context.role) metadata.role = context.role;

  const extractCode = data.extract_code || data.extractCode;
  if (extractCode) metadata.extract_code = extractCode;
  if (data.name) metadata.link_name = data.name;

  return JSON.stringify(metadata);
}

async function findLinkFileBucket(
  projectId: string,
  fileType: FileType,
  context: TaskUploadContext
) {
  if (!context.taskId || !context.role) {
    return null;
  }

  const candidates = await prisma.fileEntity.findMany({
    where: {
      project_id: projectId,
      file_type: fileType,
      is_deleted: false,
    },
  });

  return candidates
    .filter((file) => {
      const metadata = parseMetadata(file.metadata);
      return (
        getMetadataStringValue(metadata, "asset_kind", "assetKind") === "link" &&
        getMetadataStringValue(metadata, "task_id", "taskId") === context.taskId &&
        getMetadataStringValue(metadata, "role", "task_role") === context.role
      );
    })
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0] || null;
}

function decorateLinkWithMetadata<T extends {
  file?: { metadata?: string | null; tags?: string | null; file_type?: FileType | null; name?: string | null } | null;
  description?: string | null;
  url: string;
}>(link: T) {
  const metadata = parseMetadata(link.file?.metadata);
  return {
    ...link,
    name: link.description || getMetadataStringValue(metadata, "link_name", "linkName") || link.file?.name || link.url,
    extract_code: getMetadataStringValue(metadata, "extract_code", "extractCode"),
    file_type: link.file?.file_type || FileType.other,
    task_id: getMetadataStringValue(metadata, "task_id", "taskId"),
    unit_id: getMetadataStringValue(metadata, "unit_id", "unitId"),
    role: getMetadataStringValue(metadata, "role", "task_role"),
    tag_list: parseTagList(link.file?.tags),
  };
}

export async function createLinkAsset(
  creatorId: string,
  data: CreateLinkInput
) {
  const projectId = data.project_id || data.projectId;
  if (!projectId) {
    throw new AppError("Project ID is required", "VALIDATION_ERROR", 400);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  const taskContext = await resolveTaskUploadContext(projectId, data);
  if (taskContext.role && taskContext.role !== TaskRole.source && taskContext.role !== TaskRole.encoding) {
    throw new AppError("Only source and encoding tasks can submit cloud drive links", "VALIDATION_ERROR", 400);
  }

  const fileType = data.file_type || data.type || (
    taskContext.role === TaskRole.source || taskContext.role === TaskRole.encoding
      ? FileType.video
      : FileType.other
  );
  let fileId = data.file_id || undefined;

  // If file_id is provided, verify it belongs to the project
  if (fileId) {
    const file = await prisma.fileEntity.findUnique({
      where: { id: fileId },
    });

    if (!file || file.project_id !== projectId) {
      throw new AppError("File not found in project", "NOT_FOUND", 404);
    }
  }

  if (!fileId && taskContext.taskId && taskContext.role) {
    const existingLinkFile = await findLinkFileBucket(projectId, fileType, taskContext);
    if (existingLinkFile) {
      fileId = existingLinkFile.id;
      await prisma.fileEntity.update({
        where: { id: fileId },
        data: {
          name: buildDisplayFilename(
            {
              project_id: projectId,
              name: `${data.name || data.description || "网盘链接"}.url`,
              file_type: fileType,
              mime_type: "text/uri-list",
              size_bytes: 0,
              storage_path: data.url,
              metadata: metadataStringForLink(data, taskContext),
            },
            taskContext
          ),
          metadata: metadataStringForLink(data, taskContext),
          tags: tagsStringForLink(data),
        },
      });
    } else {
      const linkFile = await prisma.fileEntity.create({
        data: {
          project_id: projectId,
          uploader_id: creatorId,
          name: buildDisplayFilename(
            {
              project_id: projectId,
              name: `${data.name || data.description || "网盘链接"}.url`,
              file_type: fileType,
              mime_type: "text/uri-list",
              size_bytes: 0,
              storage_path: data.url,
              metadata: metadataStringForLink(data, taskContext),
            },
            taskContext
          ),
          original_name: data.name || data.description || "网盘链接",
          file_type: fileType,
          mime_type: "text/uri-list",
          size_bytes: 0,
          storage_path: data.url,
          checksum: null,
          metadata: metadataStringForLink(data, taskContext),
          tags: tagsStringForLink(data),
        },
      });
      fileId = linkFile.id;
    }
  }

  if (!fileId) {
    const linkFile = await prisma.fileEntity.create({
      data: {
        project_id: projectId,
        uploader_id: creatorId,
        name: data.name || data.description || "网盘链接",
        original_name: data.name || data.description || "网盘链接",
        file_type: fileType,
        mime_type: "text/uri-list",
        size_bytes: 0,
        storage_path: data.url,
        checksum: null,
        metadata: metadataStringForLink(data, taskContext),
        tags: tagsStringForLink(data),
      },
    });
    fileId = linkFile.id;
  }

  const link = await prisma.linkHistory.create({
    data: {
      project_id: projectId,
      file_id: fileId,
      url: data.url,
      link_type: data.link_type,
      description: data.description || data.name,
      expires_at: data.expires_at ? new Date(data.expires_at) : null,
      created_by: creatorId,
    },
    include: {
      file: {
        select: {
          id: true,
          name: true,
          file_type: true,
          metadata: true,
          tags: true,
        },
      },
    },
  });

  await syncSourceEpisodeLength(projectId, taskContext, sourceEpisodeLengthFromInput(data));

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.file_uploaded,
    title: "链接资产已添加",
    description: `链接资产「${link.description || link.url}」已添加`,
    actor_id: creatorId,
    metadata: {
      link_id: link.id,
      file_id: link.file_id,
      link_type: link.link_type,
    },
  });

  return decorateLinkWithMetadata(link);
}

export async function getLinkHistory(projectId: string) {
  const where: Record<string, unknown> = {};
  if (projectId) {
    where.project_id = projectId;
  }

  const links = await prisma.linkHistory.findMany({
    where,
    orderBy: { created_at: "desc" },
    include: {
      file: {
        select: {
          id: true,
          name: true,
          file_type: true,
          metadata: true,
          tags: true,
        },
      },
    },
  });

  return links.map(decorateLinkWithMetadata);
}

export async function deleteLinkAsset(linkId: string) {
  const link = await prisma.linkHistory.findUnique({
    where: { id: linkId },
  });

  if (!link) {
    throw new AppError("Link not found", "NOT_FOUND", 404);
  }

  await prisma.linkHistory.delete({
    where: { id: linkId },
  });

  return { success: true };
}

// ============ Batch Operations ============

export async function batchAssignTasks(
  unitId: string,
  assigneeId: string,
  taskRole?: TaskRole
) {
  const unit = await prisma.projectUnit.findUnique({
    where: { id: unitId },
    include: {
      tasks: true,
    },
  });

  if (!unit) {
    throw new AppError("Unit not found", "NOT_FOUND", 404);
  }

  const where: Record<string, unknown> = {
    unit_id: unitId,
  };

  if (taskRole) {
    where.role = taskRole;
  }

  // Assign all matching tasks to the same person
  const updated = await prisma.task.updateMany({
    where,
    data: {
      assignee_id: assigneeId,
      status: "assigned",
      started_at: new Date(),
    },
  });

  return {
    assigned_count: updated.count,
    unit_id: unitId,
    assignee_id: assigneeId,
  };
}

export async function batchArchiveUnits(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  // Archive all units' tasks
  await prisma.task.updateMany({
    where: {
      project_id: projectId,
    },
    data: {
      status: "frozen",
    },
  });

  // Archive the project itself
  await prisma.project.update({
    where: { id: projectId },
    data: {
      is_archived: true,
      archived_at: new Date(),
      status: "archived",
    },
  });

  return {
    success: true,
    project_id: projectId,
  };
}

// ============ Cleanup Expired Links ============

export async function cleanupExpiredLinks(): Promise<number> {
  const result = await prisma.downloadLink.deleteMany({
    where: {
      expires_at: { lt: new Date() },
    },
  });

  return result.count;
}
