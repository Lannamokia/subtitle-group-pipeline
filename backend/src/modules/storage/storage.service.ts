import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  CreateStorageBackendInput,
  UpdateStorageBackendInput,
  StorageQueryInput,
} from "./storage.schema";

export async function createBackend(data: CreateStorageBackendInput) {
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

export async function getBackends(query: StorageQueryInput) {
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

export async function updateBackend(
  backendId: string,
  data: UpdateStorageBackendInput
) {
  if (data.is_default) {
    await prisma.storageBackend.updateMany({
      data: { is_default: false },
    });
  }

  const backend = await prisma.storageBackend.update({
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

  return backend;
}

export async function deleteBackend(backendId: string) {
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

  return { success: true };
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

export async function checkQuota(backendId: string, additionalBytes: number): Promise<boolean> {
  const backend = await prisma.storageBackend.findUnique({
    where: { id: backendId },
  });

  if (!backend || !backend.quota_bytes) {
    return true; // No quota = unlimited
  }

  return (backend.used_bytes + additionalBytes) <= backend.quota_bytes;
}
