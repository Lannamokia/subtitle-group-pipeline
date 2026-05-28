import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  CreateFileInput,
  CreateVersionInput,
  CreateLinkInput,
  FileQueryInput,
  UpdateUploadPolicyInput,
} from "./file.schema";

export async function createFile(uploaderId: string, data: CreateFileInput) {
  const file = await prisma.fileEntity.create({
    data: {
      project_id: data.project_id,
      uploader_id: uploaderId,
      name: data.name,
      original_name: data.name,
      file_type: data.file_type,
      mime_type: data.mime_type,
      size_bytes: data.size_bytes,
      storage_path: data.storage_path,
      checksum: data.checksum,
      metadata: data.metadata,
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

  // Create initial version
  await prisma.fileVersion.create({
    data: {
      file_id: file.id,
      version_number: 1,
      storage_path: data.storage_path,
      size_bytes: data.size_bytes,
      checksum: data.checksum,
      is_current: true,
      is_latest: true,
    },
  });

  return file;
}

export async function getFiles(query: FileQueryInput) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (!query.include_deleted) {
    where.is_deleted = false;
  }

  if (query.project_id) {
    where.project_id = query.project_id;
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

  return {
    files,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

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

export async function createVersion(
  fileId: string,
  data: CreateVersionInput
) {
  const file = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: { versions: { orderBy: { version_number: "desc" }, take: 1 } },
  });

  if (!file) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  const latestVersion = file.versions[0];
  const nextVersionNumber = (latestVersion?.version_number || 0) + 1;

  // Mark previous latest as not latest
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
      change_summary: data.change_summary,
      is_current: true,
      is_latest: true,
    },
  });

  // Update file size
  await prisma.fileEntity.update({
    where: { id: fileId },
    data: { size_bytes: data.size_bytes },
  });

  return version;
}

export async function setCurrentVersion(fileId: string, versionId: string) {
  // Unset current on all versions
  await prisma.fileVersion.updateMany({
    where: { file_id: fileId },
    data: { is_current: false },
  });

  // Set current on specified version
  const version = await prisma.fileVersion.update({
    where: { id: versionId },
    data: { is_current: true },
  });

  return version;
}

export async function createLink(
  creatorId: string,
  data: CreateLinkInput
) {
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
  });

  return link;
}

export async function softDeleteFile(
  fileId: string,
  deletedBy: string
) {
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
        "video/mkv",
        "audio/mp3",
        "audio/flac",
        "image/png",
        "image/jpeg",
        "application/zip",
        "application/x-rar",
      ]),
      max_size_bytes: 104857600,
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
