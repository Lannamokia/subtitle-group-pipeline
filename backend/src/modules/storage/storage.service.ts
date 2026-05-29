import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { LocalAdapter } from "./adapters/local.adapter";
import { S3Adapter, type S3Config } from "./adapters/s3.adapter";
import type {
  CreateStorageBackendInput,
  DataRetentionSettingsInput,
  UpdateStorageBackendInput,
  StorageQueryInput,
} from "./storage.schema";

// Adapter instance cache
const adapterCache = new Map<string, LocalAdapter | S3Adapter>();

export function getAdapterForBackend(backendId: string): LocalAdapter | S3Adapter {
  const cached = adapterCache.get(backendId);
  if (cached) {
    return cached;
  }

  throw new AppError(
    "Backend adapter not initialized. Call initAdapterForBackend first.",
    "CONFIG_ERROR",
    500
  );
}

export async function initAdapterForBackend(backendId: string): Promise<LocalAdapter | S3Adapter> {
  const cached = adapterCache.get(backendId);
  if (cached) {
    return cached;
  }

  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }

  let adapter: LocalAdapter | S3Adapter;

  if (backend.backend_type === "local") {
    adapter = new LocalAdapter();
  } else if (backend.backend_type === "s3" || backend.backend_type === "s3_compatible") {
    const config = JSON.parse(backend.config) as S3Config;
    adapter = new S3Adapter(config);
  } else {
    throw new AppError("Unknown storage backend type", "CONFIG_ERROR", 500);
  }

  adapterCache.set(backendId, adapter);
  return adapter;
}

export function clearAdapterCache(backendId?: string): void {
  if (backendId) {
    adapterCache.delete(backendId);
  } else {
    adapterCache.clear();
  }
}

export async function uploadFile(
  backendId: string,
  projectId: string,
  buffer: Buffer,
  originalFilename: string,
  contentType?: string
): Promise<{ storagePath: string; size: number }> {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }

  if (!backend.is_active) {
    throw new AppError("Storage backend is inactive", "CONFIG_ERROR", 500);
  }

  // Check quota
  const hasQuota = await checkQuota(backendId, buffer.length);
  if (!hasQuota) {
    throw new AppError("Storage quota exceeded", "QUOTA_EXCEEDED", 413);
  }

  const adapter = await initAdapterForBackend(backendId);

  let result: { internalPath: string; size: number };

  if (adapter instanceof LocalAdapter) {
    const uploadResult = await adapter.upload(projectId, buffer, originalFilename);
    result = { internalPath: uploadResult.internalPath, size: uploadResult.size };
  } else {
    const uploadResult = await adapter.upload(projectId, buffer, originalFilename, contentType);
    result = { internalPath: uploadResult.key, size: uploadResult.size };
  }

  // Update quota
  await updateUsage(backendId, result.size, 1);

  return {
    storagePath: result.internalPath,
    size: result.size,
  };
}

export async function deleteFile(
  backendId: string,
  storagePath: string,
  sizeBytes: number
): Promise<void> {
  const adapter = await initAdapterForBackend(backendId);

  if (adapter instanceof LocalAdapter) {
    await adapter.delete(storagePath);
  } else {
    await adapter.delete(storagePath);
  }

  // Update quota
  await updateUsage(backendId, -sizeBytes, -1);
}

export async function getDownloadUrl(
  backendId: string,
  storagePath: string,
  ttlSeconds: number = 300
): Promise<string> {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }

  const adapter = await initAdapterForBackend(backendId);

  if (adapter instanceof LocalAdapter) {
    // For local storage, return a token-based URL
    return adapter.getUrl(storagePath);
  } else {
    // For S3, generate presigned URL
    return adapter.getPresignedUrl(storagePath, ttlSeconds);
  }
}

export async function getStorageBackends(query: StorageQueryInput) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (query.backend_type) {
    where.backend_type = query.backend_type;
  }
  if (query.is_active !== undefined) {
    where.is_active = query.is_active;
  }

  const [backends, total] = await Promise.all([
    prisma.storageBackend.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
    }),
    prisma.storageBackend.count({ where }),
  ]);

  return {
    backends,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function createStorageBackend(data: CreateStorageBackendInput) {
  // Validate config is valid JSON
  try {
    JSON.parse(data.config);
  } catch {
    throw new AppError("Config must be valid JSON", "VALIDATION_ERROR", 400);
  }

  if (data.is_default) {
    await prisma.storageBackend.updateMany({
      data: { is_default: false },
    });
  }

  const backend = await prisma.storageBackend.create({
    data: {
      name: data.name,
      backend_type: data.backend_type,
      config: data.config,
      is_default: data.is_default,
      quota_bytes: data.quota_bytes,
    },
  });

  return backend;
}

export async function updateStorageBackend(
  backendId: string,
  data: UpdateStorageBackendInput
) {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }

  // Validate config is valid JSON if provided
  if (data.config) {
    try {
      JSON.parse(data.config);
    } catch {
      throw new AppError("Config must be valid JSON", "VALIDATION_ERROR", 400);
    }
  }

  if (data.is_default) {
    await prisma.storageBackend.updateMany({
      data: { is_default: false },
    });
  }

  const updated = await prisma.storageBackend.update({
    where: { id: backendId },
    data: {
      name: data.name,
      backend_type: data.backend_type,
      config: data.config,
      is_default: data.is_default,
      quota_bytes: data.quota_bytes,
      is_active: data.is_active,
    },
  });

  // Clear adapter cache since config may have changed
  clearAdapterCache(backendId);

  return updated;
}

export async function deleteStorageBackend(backendId: string) {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }

  // Check if backend is in use
  const projectsUsing = await prisma.project.count({
    where: { storage_backend_id: backendId },
  });

  if (projectsUsing > 0) {
    throw new AppError(
      "Cannot delete backend that is in use by projects",
      "CONFLICT",
      409
    );
  }

  await prisma.storageBackend.delete({
    where: { id: backendId },
  });

  clearAdapterCache(backendId);

  return { success: true };
}

export async function getBackendById(backendId: string) {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }

  return backend;
}

export async function getDefaultBackend() {
  const backend = await prisma.storageBackend.findFirst({
    where: { is_default: true, is_active: true },
  });

  if (!backend) {
    // Fallback to first active backend
    const fallback = await prisma.storageBackend.findFirst({
      where: { is_active: true },
    });

    if (!fallback) {
      throw new AppError(
        "No active storage backend configured",
        "CONFIG_ERROR",
        500
      );
    }

    return fallback;
  }

  return backend;
}

export async function updateUsage(
  backendId: string,
  sizeDelta: number,
  fileCountDelta: number
) {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }

  const newUsed = Math.max(0, backend.used_bytes + sizeDelta);
  const newFileCount = Math.max(0, backend.file_count + fileCountDelta);

  await prisma.storageBackend.update({
    where: { id: backendId },
    data: {
      used_bytes: newUsed,
      file_count: newFileCount,
    },
  });

  return { used_bytes: newUsed, file_count: newFileCount };
}

export async function checkQuota(
  backendId: string,
  additionalBytes: number
): Promise<boolean> {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend || !backend.quota_bytes) {
    return true; // No quota = unlimited
  }

  return (backend.used_bytes + additionalBytes) <= backend.quota_bytes;
}

// ==================== AVATAR UPLOAD ====================

const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const AVATAR_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export interface AvatarUploadResult {
  avatarUrl: string;
  size: number;
}

export async function uploadAvatar(
  userId: string,
  buffer: Buffer,
  contentType: string,
  originalFilename: string
): Promise<AvatarUploadResult> {
  // Validate file type
  if (!AVATAR_ALLOWED_TYPES.includes(contentType)) {
    throw new AppError(
      `Invalid file type. Allowed: ${AVATAR_ALLOWED_TYPES.join(", ")}`,
      "VALIDATION_ERROR",
      400
    );
  }

  // Validate file size
  if (buffer.length > AVATAR_MAX_SIZE) {
    throw new AppError(
      `Avatar too large. Max size: ${AVATAR_MAX_SIZE / 1024 / 1024}MB`,
      "VALIDATION_ERROR",
      400
    );
  }

  // Get the system default backend (for avatars, we use the default storage backend)
  const backend = await getDefaultBackend();

  // Check quota
  const hasQuota = await checkQuota(backend.id, buffer.length);
  if (!hasQuota) {
    throw new AppError("Storage quota exceeded", "QUOTA_EXCEEDED", 413);
  }

  const adapter = await initAdapterForBackend(backend.id);

  let storagePath: string;
  let size: number;

  if (adapter instanceof LocalAdapter) {
    const ext = originalFilename.split(".").pop() || "png";
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "");
    const avatarPath = `avatars/${userId}.${safeExt}`;

    // Delete old avatar if exists
    try {
      const exists = await adapter.exists(avatarPath);
      if (exists) {
        await adapter.delete(avatarPath);
        await updateUsage(backend.id, 0, -1);
      }
    } catch {
      // Ignore cleanup errors
    }

    const result = await adapter.upload("avatars", buffer, `${userId}.${safeExt}`);
    storagePath = result.internalPath;
    size = result.size;
  } else {
    const ext = originalFilename.split(".").pop() || "png";
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "");
    const key = `avatars/${userId}.${safeExt}`;

    // Delete old avatar if exists
    try {
      const exists = await adapter.exists(key);
      if (exists) {
        await adapter.delete(key);
        await updateUsage(backend.id, 0, -1);
      }
    } catch {
      // Ignore cleanup errors
    }

    const result = await adapter.upload("avatars", buffer, `${userId}.${safeExt}`, contentType);
    storagePath = result.key;
    size = result.size;
  }

  // Update quota
  await updateUsage(backend.id, size, 1);

  // Build public URL
  let avatarUrl: string;
  if (adapter instanceof LocalAdapter) {
    avatarUrl = `/uploads/${storagePath.replace(/\\/g, "/")}`;
  } else {
    avatarUrl = storagePath;
  }

  return { avatarUrl, size };
}

export async function getStorageStats() {
  const backends = await prisma.storageBackend.findMany({
    select: {
      id: true,
      quota_bytes: true,
      used_bytes: true,
      file_count: true,
    },
  });

  const totalQuota = backends.reduce((sum, b) => sum + (b.quota_bytes || 0), 0);
  const totalUsed = backends.reduce((sum, b) => sum + b.used_bytes, 0);
  const backendCount = backends.length;

  return {
    totalQuota,
    totalUsed,
    backendCount,
  };
}

// ==================== DATA RETENTION SETTINGS ====================

export async function getDataRetentionSettings() {
  const existing = await prisma.dataRetentionSettings.findFirst({
    orderBy: { updated_at: "desc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.dataRetentionSettings.create({ data: {} });
}

export async function updateDataRetentionSettings(data: DataRetentionSettingsInput) {
  const existing = await getDataRetentionSettings();

  return prisma.dataRetentionSettings.update({
    where: { id: existing.id },
    data,
  });
}
