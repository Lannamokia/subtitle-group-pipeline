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

// ============ Upload Policy ============

export async function getUploadPolicy(projectId?: string) {
  const where: Record<string, unknown> = {};
  if (projectId) {
    where.project_id = projectId;
  } else {
    where.project_id = null;
  }

  const policy = await prisma.uploadPolicy.findFirst({
    where,
    orderBy: { created_at: "desc" },
  });

  return (
    policy || {
      allowed_types: JSON.stringify([
        "text/plain",
        "application/x-ass",
        "video/mp4",
        "video/x-matroska",
        "audio/mp3",
        "audio/flac",
        "image/png",
        "image/jpeg",
        "application/zip",
        "application/x-rar",
        "font/ttf",
        "font/otf",
        "application/octet-stream",
      ]),
      max_size_bytes: 104857600, // 100MB
      require_approval: false,
      extension_whitelist: JSON.stringify([
        ".ass",
        ".ssa",
        ".srt",
        ".mp4",
        ".mkv",
        ".mp3",
        ".flac",
        ".png",
        ".jpg",
        ".jpeg",
        ".zip",
        ".rar",
        ".ttf",
        ".otf",
        ".txt",
      ]),
    }
  );
}

export async function updateUploadPolicy(
  data: UpdateUploadPolicyInput,
  projectId?: string
) {
  const policy = await prisma.uploadPolicy.create({
    data: {
      project_id: projectId || null,
      allowed_types: data.allowed_types,
      max_size_bytes: data.max_size_bytes,
      require_approval: data.require_approval,
      extension_whitelist: data.extension_whitelist,
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
  const globalRuleKeys = ["allowed_types", "allowedTypes", "mime_types", "mimeTypes", "file_types", "fileTypes", "extensions"];
  if (globalRuleKeys.some((key) => obj[key] !== undefined)) {
    return normalizePolicyRule(obj);
  }

  const matrix = (obj.roles && typeof obj.roles === "object"
    ? obj.roles
    : obj.byRole && typeof obj.byRole === "object"
      ? obj.byRole
      : obj) as Record<string, unknown>;

  if (role && matrix[role]) {
    return normalizePolicyRule(matrix[role]);
  }

  if (userRole === "supervisor" && matrix.supervisor) {
    return normalizePolicyRule(matrix.supervisor);
  }

  if (userRole === "super_admin" || userRole === "group_admin") {
    return mergePolicyRules(Object.values(matrix).map((rule) => normalizePolicyRule(rule)));
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

  const mimeMatches = [...rule.raw, ...rule.mimeTypes].some((allowed) => {
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
    ? [...rule.raw, ...rule.extensions].includes(ext)
    : false;

  return mimeMatches || fileTypeMatches || extensionMatches;
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

function metadataStringForUpload(data: UploadFileInput): string | null | undefined {
  const metadata = parseMetadata(data.metadata);
  const taskId = data.task_id || data.taskId;
  const unitId = data.unit_id || data.unitId;

  if (taskId) {
    metadata.task_id = taskId;
  }
  if (unitId) {
    metadata.unit_id = unitId;
  }
  if (data.role) {
    metadata.role = data.role;
  }

  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : data.metadata;
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

  // Get policy
  const policy = await getUploadPolicy(projectId);
  const policyConfig = safeJsonParse<unknown>(policy.allowed_types, []);
  const taskRole = await resolveUploadRole(
    projectId,
    userRole,
    options.userId,
    options.taskRole
  );
  const allowedRule = roleRuleFromPolicy(policyConfig, taskRole, userRole);
  const maxSize = policy.max_size_bytes;
  const whitelist = policy.extension_whitelist
    ? safeJsonParse<string[]>(policy.extension_whitelist, [])
    : null;

  if (!allowedRule || allowedRule.raw.length + allowedRule.mimeTypes.length + allowedRule.fileTypes.length + allowedRule.extensions.length === 0) {
    return {
      valid: false,
      error: taskRole
        ? `No upload policy is configured for role ${taskRole}`
        : "No upload policy is configured for the uploader role",
    };
  }

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
      taskRole: data.role,
      fileType: data.file_type,
    }
  );

  if (!uploadValidation.valid) {
    throw new AppError(uploadValidation.error || "Invalid upload", "VALIDATION_ERROR", 400);
  }

  // Determine storage backend
  const storageBackendId = data.storage_backend_id || project.storage_backend_id;

  // Sanitize filename
  const sanitizedName = sanitizeFilename(data.name);
  const metadata = metadataStringForUpload(data);

  // Create file entity
  const file = await prisma.fileEntity.create({
    data: {
      project_id: data.project_id,
      uploader_id: uploaderId,
      name: sanitizedName,
      original_name: data.name,
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
    title: "File uploaded",
    description: `File "${file.name}" was uploaded`,
    actor_id: uploaderId,
    metadata: {
      file_id: file.id,
      version_id: version.id,
      file_type: file.file_type,
      task_id: data.task_id || data.taskId,
    },
  });

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

  const latestVersion = file.versions[0];
  const nextVersionNumber = (latestVersion?.version_number || 0) + 1;

  // Determine storage backend
  const storageBackendId = data.storage_backend_id || file.storage_backend_id;

  // Sanitize name if provided
  const sanitizedName = data.name ? sanitizeFilename(data.name) : file.name;

  // Mark all previous versions as not latest
  await prisma.fileVersion.updateMany({
    where: { file_id: fileId },
    data: { is_latest: false },
  });

  // Create new version
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

  // Update file entity
  const updatedFile = await prisma.fileEntity.update({
    where: { id: fileId },
    data: {
      name: sanitizedName,
      size_bytes: data.size_bytes,
      storage_path: data.storage_path,
      storage_backend_id: storageBackendId,
      checksum: data.checksum,
      metadata: data.metadata,
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

  // Auto-resolve current_version: latest_approved if exists, else latest
  await resolveCurrentVersion(fileId);

  await timelineService.createTimelineEvent({
    project_id: file.project_id,
    event_type: TimelineEventType.file_uploaded,
    title: "File replaced",
    description: `File "${updatedFile.name}" received a new version`,
    actor_id: uploaderId,
    metadata: {
      file_id: fileId,
      version_id: version.id,
      version_number: version.version_number,
    },
  });

  return {
    ...updatedFile,
    current_version: version,
    latest_version: version,
  };
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

  const binaryItems = decoratedFiles.map((file) => ({
    ...file,
    asset_kind: "binary" as const,
  }));
  const items = [...binaryItems, ...decoratedLinks]
    .sort((a, b) => b.latest_update_at.getTime() - a.latest_update_at.getTime());
  const pagedItems = items.slice(skip, skip + pageSize);
  const itemIds = new Set(pagedItems.map((item) => `${item.asset_kind}:${item.id}`));

  return {
    files: binaryItems.filter((file) => itemIds.has(`binary:${file.id}`)),
    links: decoratedLinks.filter((link) => itemIds.has(`link:${link.id}`)),
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
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  if (file.is_deleted) {
    throw new AppError("File is already deleted", "BAD_REQUEST", 400);
  }

  await prisma.fileEntity.update({
    where: { id: fileId },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: deletedBy,
    },
  });

  return { success: true };
}

// ============ Download Link ============

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
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
  requestedTtl: number = 300
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
        where: { is_current: true },
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

  // Get current version
  const currentVersion = file.versions[0];
  if (!currentVersion) {
    throw new AppError("No current version available", "NOT_FOUND", 404);
  }

  // Calculate TTL
  const configuredTtl = await resolveConfiguredDownloadTtl(file.project, requestedTtl);
  const ttlSeconds = getMinimumTtl(file.file_type, configuredTtl);
  const now = new Date();
  const nextSecond = Math.ceil(now.getTime() / 1000) * 1000;
  const expiresAt = new Date(nextSecond + ttlSeconds * 1000);

  // Check for existing non-expired link for same user+file
  const existingLink = await prisma.downloadLink.findFirst({
    where: {
      file_id: fileId,
      created_by: userId,
      is_active: true,
      expires_at: { gt: new Date(now.getTime() + 30 * 1000) }, // expires more than 30s from now
    },
    orderBy: { created_at: "desc" },
  });

  if (existingLink) {
    // Reuse existing link
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

  // Determine storage backend
  let backend = file.project.storage_backend;
  if (file.storage_backend_id && file.storage_backend_id !== backend?.id) {
    backend = await prisma.storageBackend.findUnique({
      where: { id: file.storage_backend_id },
    });
  }
  const storageBackendId = file.storage_backend_id || backend?.id;

  let downloadUrl: string;
  const token = generateToken();

  if (backend?.backend_type === "s3" || backend?.backend_type === "s3_compatible") {
    // For S3, generate presigned URL
    const { getS3Config } = await import("../storage/storage.service");
    const { S3Adapter } = await import("../storage/adapters/s3.adapter");
    const config = getS3Config(backend.config);
    const s3Adapter = new S3Adapter(config);
    downloadUrl = await s3Adapter.getPresignedUrl(
      currentVersion.storage_path,
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

  // Increment download count
  await prisma.downloadLink.update({
    where: { id: link.id },
    data: { download_count: { increment: 1 } },
  });

  return link;
}

// ============ Link Asset (LinkHistory) ============

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

  // If file_id is provided, verify it belongs to the project
  if (data.file_id) {
    const file = await prisma.fileEntity.findUnique({
      where: { id: data.file_id },
    });

    if (!file || file.project_id !== projectId) {
      throw new AppError("File not found in project", "NOT_FOUND", 404);
    }
  }

  const link = await prisma.linkHistory.create({
    data: {
      project_id: projectId,
      file_id: data.file_id,
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
        },
      },
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.file_uploaded,
    title: "Link asset created",
    description: `Link asset "${link.description || link.url}" was added`,
    actor_id: creatorId,
    metadata: {
      link_id: link.id,
      file_id: link.file_id,
      link_type: link.link_type,
    },
  });

  return link;
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
        },
      },
    },
  });

  return links;
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
