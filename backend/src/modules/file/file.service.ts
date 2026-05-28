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
import type { UserRole, TaskRole } from "@prisma/client";

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
  userRole: UserRole
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
  const allowedTypes = JSON.parse(policy.allowed_types) as string[];
  const maxSize = policy.max_size_bytes;
  const whitelist = policy.extension_whitelist
    ? (JSON.parse(policy.extension_whitelist) as string[])
    : null;

  // Check MIME type
  if (!allowedTypes.includes(file.mimetype) && !allowedTypes.includes("*/*")) {
    return {
      valid: false,
      error: `File type ${file.mimetype} is not allowed. Allowed: ${allowedTypes.join(", ")}`,
    };
  }

  // Check extension whitelist
  if (whitelist && whitelist.length > 0 && !whitelist.includes(ext)) {
    return {
      valid: false,
      error: `File extension ${ext} is not allowed. Allowed: ${whitelist.join(", ")}`,
    };
  }

  // Check size
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size ${file.size} exceeds maximum allowed ${maxSize} bytes`,
    };
  }

  // Check global max size from env
  if (file.size > env.UPLOAD_MAX_SIZE) {
    return {
      valid: false,
      error: `File size exceeds global maximum of ${env.UPLOAD_MAX_SIZE} bytes`,
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
): Promise<unknown> {
  // Validate project exists
  const project = await prisma.project.findUnique({
    where: { id: data.project_id },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  // Determine storage backend
  const storageBackendId = data.storage_backend_id || project.storage_backend_id;

  // Sanitize filename
  const sanitizedName = sanitizeFilename(data.name);

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

  return {
    ...file,
    current_version: version,
    latest_version: version,
  };
}

// ============ Replace File (explicit replace) ============

export async function replaceFile(
  fileId: string,
  uploaderId: string,
  data: ReplaceFileInput
): Promise<unknown> {
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

  const where: Record<string, unknown> = {
    project_id: projectId,
  };

  if (!query.include_deleted) {
    where.is_deleted = false;
  }

  if (query.file_type) {
    where.file_type = query.file_type;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { original_name: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [files, total] = await Promise.all([
    prisma.fileEntity.findMany({
      where,
      skip,
      take: pageSize,
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
      },
    }),
    prisma.fileEntity.count({ where }),
  ]);

  // Merge with link history
  const linkHistory = await prisma.linkHistory.findMany({
    where: { project_id: projectId },
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

  return {
    files,
    links: linkHistory,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
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
      comments: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              nickname: true,
            },
          },
        },
      },
    },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  return file;
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

export async function getDownloadLink(
  fileId: string,
  userId: string,
  userRole: UserRole,
  requestedTtl: number = 300
): Promise<{ downloadUrl: string; expiresAt: Date }> {
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
  const ttlSeconds = getMinimumTtl(file.file_type, requestedTtl);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

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
        expiresAt: existingLink.expires_at,
      };
    }
  }

  // Determine storage backend
  const backend = file.project.storage_backend;
  const storageBackendId = file.storage_backend_id || backend?.id;

  let downloadUrl: string;

  if (backend?.backend_type === "s3" || backend?.backend_type === "s3_compatible") {
    // For S3, generate presigned URL
    const { S3Adapter } = await import("../storage/adapters/s3.adapter");
    const config = JSON.parse(backend.config);
    const s3Adapter = new S3Adapter(config);
    downloadUrl = await s3Adapter.getPresignedUrl(
      currentVersion.storage_path,
      ttlSeconds
    );
  } else {
    // For local storage, create a DownloadLink record with token
    const token = generateToken();
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
  const project = await prisma.project.findUnique({
    where: { id: data.project_id },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  // If file_id is provided, verify it belongs to the project
  if (data.file_id) {
    const file = await prisma.fileEntity.findUnique({
      where: { id: data.file_id },
    });

    if (!file || file.project_id !== data.project_id) {
      throw new AppError("File not found in project", "NOT_FOUND", 404);
    }
  }

  const link = await prisma.linkHistory.create({
    data: {
      project_id: data.project_id,
      file_id: data.file_id,
      url: data.url,
      link_type: data.link_type,
      description: data.description,
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

  return link;
}

export async function getLinkHistory(projectId: string) {
  const links = await prisma.linkHistory.findMany({
    where: { project_id: projectId },
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

export async function createFile(uploaderId: string, data: UploadFileInput) {
  return uploadFile(uploaderId, data);
}

export async function cleanupExpiredLinks(): Promise<number> {
  const result = await prisma.downloadLink.updateMany({
    where: {
      is_active: true,
      expires_at: { lt: new Date() },
    },
    data: {
      is_active: false,
    },
  });

  return result.count;
}
