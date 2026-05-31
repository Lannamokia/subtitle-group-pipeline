import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as fileService from "./file.service";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { env } from "../../config/env";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { FileType, TaskRole } from "@prisma/client";
import type { UserRole } from "@prisma/client";
import * as storageService from "../storage/storage.service";
import {
  replaceFileSchema,
  uploadFileSchema,
  type AbortMultipartUploadInput,
  type CompleteMultipartUploadInput,
  type InitiateMultipartUploadInput,
  type SignMultipartPartInput,
} from "./file.schema";
import { S3Adapter } from "../storage/adapters/s3.adapter";
import {
  FONT_EXTENSIONS,
  PACKAGE_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "../../utils/defaultUploadPolicy";

const MULTIPART_UPLOAD_EXPIRES_SECONDS = 12 * 60 * 60;
const DEFAULT_MULTIPART_PART_SIZE = 64 * 1024 * 1024;
const MIN_S3_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
const MAX_S3_MULTIPART_PARTS = 10000;
const MAX_S3_MULTIPART_PART_SIZE = 5 * 1024 * 1024 * 1024;

// Helper to prevent path traversal in local download
function preventPathTraversal(filepath: string): string {
  const uploadDir = env.UPLOAD_DIR;
  const resolved = path.resolve(uploadDir, filepath);
  const uploadDirResolved = path.resolve(uploadDir);

  if (!resolved.startsWith(uploadDirResolved + path.sep) && resolved !== uploadDirResolved) {
    throw new AppError("Invalid file path", "FORBIDDEN", 403);
  }

  return resolved;
}

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

function getProjectId(req: Request): string {
  const paramProjectId = getParam(req, "projectId");
  if (paramProjectId) {
    return paramProjectId;
  }

  const bodyProjectId = (req.body as { project_id?: unknown; projectId?: unknown } | undefined)?.project_id
    ?? (req.body as { project_id?: unknown; projectId?: unknown } | undefined)?.projectId;
  if (typeof bodyProjectId === "string") {
    return bodyProjectId;
  }

  const queryProjectId = req.query.project_id ?? req.query.projectId;
  if (typeof queryProjectId === "string") {
    return queryProjectId;
  }

  if (Array.isArray(queryProjectId)) {
    return typeof queryProjectId[0] === "string" ? queryProjectId[0] : "";
  }

  return "";
}

function inferFileTypeFromInfo(originalname: string, mimetype: string, explicitType?: unknown): FileType {
  if (typeof explicitType === "string" && Object.values(FileType).includes(explicitType as FileType)) {
    return explicitType as FileType;
  }

  const ext = path.extname(originalname).toLowerCase();
  if (mimetype.startsWith("video/") || VIDEO_EXTENSIONS.includes(ext)) {
    return FileType.video;
  }
  if (SUBTITLE_EXTENSIONS.includes(ext) || mimetype.includes("subtitle")) {
    return FileType.subtitle;
  }
  if (FONT_EXTENSIONS.includes(ext) || mimetype.includes("font")) {
    return FileType.font;
  }
  if (PACKAGE_EXTENSIONS.includes(ext)) {
    return FileType.project_package;
  }
  return FileType.other;
}

function inferFileType(file: Express.Multer.File, explicitType?: unknown): FileType {
  return inferFileTypeFromInfo(file.originalname, file.mimetype, explicitType);
}

function normalizeMultipartProjectId(input: InitiateMultipartUploadInput | CompleteMultipartUploadInput): string {
  return input.project_id || input.projectId || "";
}

function normalizeMultipartFileId(input: InitiateMultipartUploadInput | CompleteMultipartUploadInput): string | undefined {
  return input.file_id || input.fileId;
}

function normalizeMultipartMimeType(input: InitiateMultipartUploadInput | CompleteMultipartUploadInput): string {
  return input.mime_type || input.mimeType || "application/octet-stream";
}

function normalizeMultipartSize(input: InitiateMultipartUploadInput | CompleteMultipartUploadInput): number {
  return input.size_bytes ?? input.sizeBytes ?? 0;
}

function normalizeMultipartUploadId(
  input: SignMultipartPartInput | CompleteMultipartUploadInput | AbortMultipartUploadInput
): string {
  return input.upload_id || input.uploadId || "";
}

function normalizeStorageBackendId(
  input: SignMultipartPartInput | CompleteMultipartUploadInput | AbortMultipartUploadInput
): string {
  return input.storage_backend_id || input.storageBackendId || "";
}

function normalizePartNumber(input: SignMultipartPartInput): number {
  return input.part_number ?? input.partNumber ?? 0;
}

function normalizeCompletedParts(input: CompleteMultipartUploadInput) {
  return input.parts.map((part) => ({
    partNumber: part.part_number ?? part.partNumber ?? 0,
    eTag: part.e_tag || part.eTag || part.ETag || "",
  }));
}

function normalizeTags(tags: unknown): string | null | undefined {
  if (Array.isArray(tags)) {
    const values = tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return values.length > 0 ? JSON.stringify(values) : null;
  }
  if (typeof tags === "string") {
    return tags;
  }
  return undefined;
}

function parseMetadataObject(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function metadataRole(metadata: string | null | undefined): TaskRole | undefined {
  const role = parseMetadataObject(metadata).role;
  return typeof role === "string" && Object.values(TaskRole).includes(role as TaskRole)
    ? role as TaskRole
    : undefined;
}

function calculateMultipartPartSize(sizeBytes: number): number {
  const requiredByPartLimit = Math.ceil(sizeBytes / MAX_S3_MULTIPART_PARTS);
  const roundedRequired = Math.ceil(requiredByPartLimit / MIN_S3_MULTIPART_PART_SIZE) * MIN_S3_MULTIPART_PART_SIZE;
  const partSize = Math.max(DEFAULT_MULTIPART_PART_SIZE, roundedRequired || MIN_S3_MULTIPART_PART_SIZE);
  if (partSize > MAX_S3_MULTIPART_PART_SIZE) {
    throw new AppError("File is too large for S3 multipart upload", "VALIDATION_ERROR", 400);
  }
  return partSize;
}

function assertS3KeyBelongsToProject(key: string, projectId: string): void {
  if (!key.startsWith(`projects/${projectId}/`)) {
    throw new AppError("Multipart upload key does not belong to this project", "FORBIDDEN", 403);
  }
}

async function getS3AdapterForBackend(backendId: string) {
  const backend = await prisma.storageBackend.findUnique({ where: { id: backendId } });
  if (!backend || !backend.is_active) {
    throw new AppError("Storage backend is not available", "CONFIG_ERROR", 500);
  }
  if (backend.backend_type !== "s3" && backend.backend_type !== "s3_compatible") {
    throw new AppError("Multipart direct upload requires an S3 storage backend", "VALIDATION_ERROR", 400);
  }

  return {
    backend,
    adapter: new S3Adapter(storageService.getS3Config(backend.config)),
  };
}

async function resolveMultipartTarget(
  input: InitiateMultipartUploadInput | CompleteMultipartUploadInput,
  preferredBackendId?: string
) {
  const fileId = normalizeMultipartFileId(input);
  const sizeBytes = normalizeMultipartSize(input);
  const mimeType = normalizeMultipartMimeType(input);

  if (fileId) {
    const existing = await prisma.fileEntity.findUnique({
      where: { id: fileId },
      include: { project: { select: { storage_backend_id: true } } },
    });
    if (!existing) {
      throw new AppError("File not found", "NOT_FOUND", 404);
    }
    if (existing.is_deleted) {
      throw new AppError("Cannot replace a deleted file", "BAD_REQUEST", 400);
    }
    const backendId = preferredBackendId || existing.storage_backend_id || existing.project.storage_backend_id;
    const backend = backendId
      ? await prisma.storageBackend.findUnique({ where: { id: backendId } })
      : await storageService.getDefaultBackend();
    if (!backend || !backend.is_active) {
      throw new AppError("No active storage backend configured for replacement", "CONFIG_ERROR", 500);
    }
    return {
      mode: "replace" as const,
      fileId,
      projectId: existing.project_id,
      backend,
      fileType: existing.file_type,
      taskRole: metadataRole(existing.metadata),
      originalname: input.name,
      mimetype: mimeType,
      sizeBytes,
    };
  }

  const projectId = normalizeMultipartProjectId(input);
  if (!projectId) {
    throw new AppError("Project ID is required for file upload", "VALIDATION_ERROR", 400);
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { storage_backend_id: true },
  });
  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }
  const backendId = preferredBackendId || project.storage_backend_id;
  const backend = backendId
    ? await prisma.storageBackend.findUnique({ where: { id: backendId } })
    : await storageService.getDefaultBackend();
  if (!backend || !backend.is_active) {
    throw new AppError("No active storage backend configured for upload", "CONFIG_ERROR", 500);
  }

  const fileType = inferFileTypeFromInfo(input.name, mimeType, input.file_type ?? input.type);
  const taskRole = typeof input.role === "string" && Object.values(TaskRole).includes(input.role as TaskRole)
    ? input.role as TaskRole
    : undefined;

  return {
    mode: "create" as const,
    fileId: undefined,
    projectId,
    backend,
    fileType,
    taskRole,
    originalname: input.name,
    mimetype: mimeType,
    sizeBytes,
  };
}

async function validateMultipartTarget(
  target: Awaited<ReturnType<typeof resolveMultipartTarget>>,
  req: AuthenticatedRequest
): Promise<void> {
  const validation = await fileService.validateUpload(
    {
      originalname: target.originalname,
      mimetype: target.mimetype,
      size: target.sizeBytes,
    },
    target.projectId,
    req.user!.role as UserRole,
    {
      userId: req.user!.id,
      taskRole: target.taskRole,
      fileType: target.fileType,
    }
  );
  if (!validation.valid) {
    throw new AppError(validation.error || "Invalid upload", "VALIDATION_ERROR", 400);
  }
}

async function buildUploadInputFromMultipart(req: AuthenticatedRequest) {
  if (!req.file) {
    return null;
  }

  const projectId = getProjectId(req);
  if (!projectId) {
    throw new AppError("Project ID is required for file upload", "VALIDATION_ERROR", 400);
  }

  const body = req.body as Record<string, unknown>;
  const taskRole = typeof body.role === "string" && Object.values(TaskRole).includes(body.role as TaskRole)
    ? body.role as TaskRole
    : undefined;
  const inferredType = inferFileType(req.file, body.file_type ?? body.type);
  const validation = await fileService.validateUpload(
    {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    },
    projectId,
    req.user!.role as UserRole,
    {
      userId: req.user!.id,
      taskRole,
      fileType: inferredType,
    }
  );
  if (!validation.valid) {
    throw new AppError(validation.error || "Invalid upload", "VALIDATION_ERROR", 400);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { storage_backend_id: true },
  });
  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  const backend = project.storage_backend_id
    ? await prisma.storageBackend.findUnique({ where: { id: project.storage_backend_id } })
    : await storageService.getDefaultBackend();
  if (!backend || !backend.is_active) {
    throw new AppError("No active storage backend configured for upload", "CONFIG_ERROR", 500);
  }

  const uploadResult = await storageService.uploadFile(
    backend.id,
    projectId,
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype
  );

  const checksum = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

  return {
    project_id: projectId,
    name: typeof body.name === "string" && body.name.trim() ? body.name : req.file.originalname,
    file_type: inferredType,
    mime_type: req.file.mimetype || "application/octet-stream",
    size_bytes: uploadResult.size,
    storage_path: uploadResult.storagePath,
    storage_backend_id: backend.id,
    checksum,
    metadata: typeof body.metadata === "string" ? body.metadata : null,
    tags: typeof body.tags === "string" ? body.tags : null,
    task_id: typeof body.task_id === "string" ? body.task_id : undefined,
    taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    unit_id: typeof body.unit_id === "string" ? body.unit_id : undefined,
    unitId: typeof body.unitId === "string" ? body.unitId : undefined,
    role: taskRole,
    episode_length: typeof body.episode_length === "string" && body.episode_length.trim()
      ? Number(body.episode_length)
      : undefined,
    change_summary: typeof body.change_summary === "string" ? body.change_summary : null,
  };
}

async function buildReplaceInputFromMultipart(req: AuthenticatedRequest, fileId: string) {
  if (!req.file) {
    return null;
  }

  const existing = await prisma.fileEntity.findUnique({
    where: { id: fileId },
    include: {
      project: { select: { storage_backend_id: true } },
    },
  });
  if (!existing) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  const body = req.body as Record<string, unknown>;
  const metadata = typeof body.metadata === "string" ? body.metadata : existing.metadata;
  let parsedMetadata: Record<string, unknown> = {};
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata);
      parsedMetadata = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      parsedMetadata = {};
    }
  }
  const metadataRole = typeof parsedMetadata.role === "string" ? parsedMetadata.role : undefined;
  const taskRole = metadataRole && Object.values(TaskRole).includes(metadataRole as TaskRole)
    ? metadataRole as TaskRole
    : undefined;

  const validation = await fileService.validateUpload(
    {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    },
    existing.project_id,
    req.user!.role as UserRole,
    {
      userId: req.user!.id,
      taskRole,
      fileType: existing.file_type,
    }
  );
  if (!validation.valid) {
    throw new AppError(validation.error || "Invalid upload", "VALIDATION_ERROR", 400);
  }

  const backendId = existing.storage_backend_id || existing.project.storage_backend_id;
  const backend = backendId
    ? await prisma.storageBackend.findUnique({ where: { id: backendId } })
    : await storageService.getDefaultBackend();
  if (!backend || !backend.is_active) {
    throw new AppError("No active storage backend configured for replacement", "CONFIG_ERROR", 500);
  }

  const uploadResult = await storageService.uploadFile(
    backend.id,
    existing.project_id,
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype
  );
  const checksum = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

  return {
    name: typeof body.name === "string" && body.name.trim() ? body.name : req.file.originalname,
    mime_type: req.file.mimetype || "application/octet-stream",
    size_bytes: uploadResult.size,
    storage_path: uploadResult.storagePath,
    storage_backend_id: backend.id,
    checksum,
    metadata,
    tags: typeof body.tags === "string" ? body.tags : existing.tags,
    change_summary: typeof body.change_summary === "string" ? body.change_summary : null,
  };
}

function getRequestedTtl(req: Request): number {
  const queryTtl = req.query.ttl;
  if (typeof queryTtl === "string") {
    return parseInt(queryTtl, 10);
  }

  const bodyTtl = (req.body as { ttl?: unknown } | undefined)?.ttl;
  if (typeof bodyTtl === "number") {
    return bodyTtl;
  }

  if (typeof bodyTtl === "string") {
    return parseInt(bodyTtl, 10);
  }

  return 300;
}

// POST /projects/:projectId/files - Upload new file
export async function initiateMultipartUpload(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = req.body as InitiateMultipartUploadInput;
    const target = await resolveMultipartTarget(input);
    await validateMultipartTarget(target, req);

    if (target.backend.backend_type !== "s3" && target.backend.backend_type !== "s3_compatible") {
      successResponse(res, {
        uploadMode: "server",
        mode: "server",
        reason: "The selected storage backend does not support browser multipart upload",
      });
      return;
    }

    const hasQuota = await storageService.checkQuota(target.backend.id, target.sizeBytes);
    if (!hasQuota) {
      throw new AppError("Storage quota exceeded", "QUOTA_EXCEEDED", 413);
    }

    const adapter = new S3Adapter(storageService.getS3Config(target.backend.config));
    const session = await adapter.createMultipartUpload(
      target.projectId,
      target.originalname,
      target.mimetype
    );
    const partSize = calculateMultipartPartSize(target.sizeBytes);
    const partCount = Math.max(1, Math.ceil(target.sizeBytes / partSize));

    successResponse(res, {
      uploadMode: "multipart",
      mode: "multipart",
      storageBackendId: target.backend.id,
      storage_backend_id: target.backend.id,
      key: session.key,
      uploadId: session.uploadId,
      upload_id: session.uploadId,
      partSize,
      part_size: partSize,
      partCount,
      part_count: partCount,
      expiresInSeconds: MULTIPART_UPLOAD_EXPIRES_SECONDS,
      expires_in_seconds: MULTIPART_UPLOAD_EXPIRES_SECONDS,
    });
  } catch (error) {
    next(error);
  }
}

export async function signMultipartPart(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = req.body as SignMultipartPartInput;
    const { adapter } = await getS3AdapterForBackend(normalizeStorageBackendId(input));
    const uploadId = normalizeMultipartUploadId(input);
    const partNumber = normalizePartNumber(input);
    const url = await adapter.getMultipartPartUrl(
      input.key,
      uploadId,
      partNumber,
      MULTIPART_UPLOAD_EXPIRES_SECONDS
    );
    successResponse(res, {
      url,
      partNumber,
      part_number: partNumber,
      expiresInSeconds: MULTIPART_UPLOAD_EXPIRES_SECONDS,
      expires_in_seconds: MULTIPART_UPLOAD_EXPIRES_SECONDS,
    });
  } catch (error) {
    next(error);
  }
}

export async function completeMultipartUpload(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  let completedKey: string | null = null;
  let usageUpdated = false;
  let actualSize = 0;

  try {
    const input = req.body as CompleteMultipartUploadInput;
    const backendId = normalizeStorageBackendId(input);
    const target = await resolveMultipartTarget(input, backendId);
    await validateMultipartTarget(target, req);
    assertS3KeyBelongsToProject(input.key, target.projectId);

    if (target.backend.id !== backendId) {
      throw new AppError("Multipart upload backend does not match the target file", "VALIDATION_ERROR", 400);
    }

    const { adapter } = await getS3AdapterForBackend(backendId);
    const hasQuota = await storageService.checkQuota(backendId, target.sizeBytes);
    if (!hasQuota) {
      await adapter.abortMultipartUpload(input.key, normalizeMultipartUploadId(input)).catch(() => undefined);
      throw new AppError("Storage quota exceeded", "QUOTA_EXCEEDED", 413);
    }

    const completed = await adapter.completeMultipartUpload(
      input.key,
      normalizeMultipartUploadId(input),
      normalizeCompletedParts(input)
    );
    completedKey = input.key;
    actualSize = await adapter.getSize(input.key);

    if (actualSize !== target.sizeBytes) {
      await adapter.delete(input.key).catch(() => undefined);
      completedKey = null;
      throw new AppError("Uploaded object size does not match the requested file size", "VALIDATION_ERROR", 400);
    }

    await storageService.updateUsage(backendId, actualSize, 1);
    usageUpdated = true;

    const commonData = {
      name: input.name,
      mime_type: target.mimetype,
      size_bytes: actualSize,
      storage_path: input.key,
      storage_backend_id: backendId,
      checksum: completed.etag || null,
      metadata: input.metadata ?? null,
      tags: normalizeTags(input.tags),
      change_summary: input.change_summary ?? input.changeSummary ?? null,
    };

    const result = target.mode === "replace"
      ? await fileService.replaceFile(
          target.fileId!,
          req.user!.id,
          commonData
        )
      : await fileService.uploadFile(req.user!.id, {
          ...commonData,
          project_id: target.projectId,
          file_type: target.fileType,
          task_id: input.task_id,
          taskId: input.taskId,
          unit_id: input.unit_id,
          unitId: input.unitId,
          role: input.role,
          episode_length: input.episode_length,
          episodeLength: input.episodeLength,
        });

    successResponse(res, result, target.mode === "replace" ? 200 : 201);
  } catch (error) {
    if (usageUpdated) {
      await storageService.updateUsage(normalizeStorageBackendId(req.body as CompleteMultipartUploadInput), -actualSize, -1).catch(() => undefined);
    }
    if (completedKey) {
      const backendId = normalizeStorageBackendId(req.body as CompleteMultipartUploadInput);
      if (backendId) {
        try {
          const { adapter } = await getS3AdapterForBackend(backendId);
          await adapter.delete(completedKey);
        } catch {
          // Best-effort cleanup only.
        }
      }
    }
    next(error);
  }
}

export async function abortMultipartUpload(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = req.body as AbortMultipartUploadInput;
    const { adapter } = await getS3AdapterForBackend(normalizeStorageBackendId(input));
    await adapter.abortMultipartUpload(input.key, normalizeMultipartUploadId(input));
    successResponse(res, { aborted: true });
  } catch (error) {
    next(error);
  }
}

export async function uploadFile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const multipartInput = await buildUploadInputFromMultipart(req);
    const input = multipartInput || uploadFileSchema.parse({
      ...req.body,
      project_id: req.body.project_id ?? getProjectId(req),
    });
    const result = await fileService.uploadFile(req.user!.id, input);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

// POST /projects/:projectId/files/:fileId/replace - Replace existing
export async function replaceFile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const multipartInput = await buildReplaceInputFromMultipart(req, getParam(req, "fileId"));
    const input = multipartInput || replaceFileSchema.parse(req.body);
    const result = await fileService.replaceFile(
      getParam(req, "fileId"),
      req.user!.id,
      input
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// GET /projects/:projectId/files - List files
export async function getProjectFiles(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getProjectFiles(
      getProjectId(req),
      req.query as unknown as Parameters<typeof fileService.getProjectFiles>[1]
    );
    successResponse(res, { files: result.files, links: result.links, items: result.items }, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

// GET /files/:fileId - File detail
export async function getFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getFileById(getParam(req, "fileId"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// GET /files/:fileId/versions - Version history
export async function getFileVersions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getFileVersions(getParam(req, "fileId"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// POST /files/:fileId/versions/:versionId/approve - Approve version
export async function approveVersion(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.approveVersion(
      getParam(req, "fileId"),
      getParam(req, "versionId"),
      req.user!.id
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// GET /files/:fileId/download - Get download link
export async function getDownloadLink(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ttl = getRequestedTtl(req);
    const result = await fileService.getDownloadLink(
      getParam(req, "fileId"),
      req.user!.id,
      req.user!.role as "super_admin" | "group_admin" | "supervisor" | "member",
      ttl
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// GET /files/:fileId/versions/:versionId/download - Get download link for a specific version
export async function getVersionDownloadLink(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ttl = getRequestedTtl(req);
    const result = await fileService.getDownloadLink(
      getParam(req, "fileId"),
      req.user!.id,
      req.user!.role as "super_admin" | "group_admin" | "supervisor" | "member",
      ttl,
      getParam(req, "versionId")
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// GET /download/:token - Actual download (local)
export async function downloadByToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const link = await fileService.verifyDownloadToken(getParam(req, "token"));

    if (!link.file_id) {
      throw new AppError("File not found", "NOT_FOUND", 404);
    }

    // Fetch the file entity
    const fileEntity = await prisma.fileEntity.findUnique({
      where: { id: link.file_id },
    });

    if (!fileEntity) {
      throw new AppError("File not found", "NOT_FOUND", 404);
    }

    const versionId = fileService.getVersionIdFromDownloadToken(link.token);
    const currentVersion = await prisma.fileVersion.findFirst({
      where: versionId
        ? {
            file_id: link.file_id,
            id: versionId,
          }
        : {
            file_id: link.file_id,
            is_current: true,
          },
    });

    if (!currentVersion) {
      throw new AppError(
        versionId ? "File version not found" : "No current version available",
        "NOT_FOUND",
        404
      );
    }

    // Get the storage backend
    const backend = fileEntity.storage_backend_id
      ? await prisma.storageBackend.findUnique({
          where: { id: fileEntity.storage_backend_id },
        })
      : null;

    if (backend?.backend_type === "s3" || backend?.backend_type === "s3_compatible") {
      // For S3, redirect to presigned URL
      const { getS3Config } = await import("../storage/storage.service");
      const { S3Adapter } = await import("../storage/adapters/s3.adapter");
      const config = getS3Config(backend.config);
      const s3Adapter = new S3Adapter(config);
      const presignedUrl = await s3Adapter.getPresignedUrl(
        currentVersion.storage_path,
        300
      );
      res.redirect(presignedUrl);
      return;
    }

    // For local storage, serve the file directly
    const safePath = preventPathTraversal(currentVersion.storage_path);

    if (!fs.existsSync(safePath)) {
      throw new AppError("File not found on disk", "NOT_FOUND", 404);
    }

    const fileName = fileEntity.name;
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader("Content-Type", fileEntity.mime_type);

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

// POST /projects/:projectId/links - Create link asset
export async function createLink(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const projectId = getProjectId(req);
    const input = {
      ...req.body,
      project_id: req.body.project_id || projectId || undefined,
    };
    const result = await fileService.createLinkAsset(req.user!.id, input);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

// GET /projects/:projectId/links - List links
export async function getLinks(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getLinkHistory(getProjectId(req));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// DELETE /files/:fileId - Soft delete
export async function deleteFile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.deleteFile(getParam(req, "fileId"), req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// DELETE /links/:linkId - Delete a link asset
export async function deleteLink(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.deleteLinkAsset(getParam(req, "linkId"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// GET /upload-policy
export async function getUploadPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.getUploadPolicy(req.query.project_id as string | undefined);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// POST /upload-policy
export async function updateUploadPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.updateUploadPolicy(
      req.body,
      req.query.project_id as string | undefined
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// POST /batch/assign-tasks
export async function batchAssignTasks(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as {
      unit_id?: string;
      unitId?: string;
      assignee_id?: string;
      assigneeId?: string;
      role?: TaskRole;
    };
    const result = await fileService.batchAssignTasks(
      body.unit_id || body.unitId || "",
      body.assignee_id || body.assigneeId || "",
      body.role
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// POST /batch/archive-units
export async function batchArchiveUnits(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as { project_id?: string; projectId?: string };
    const result = await fileService.batchArchiveUnits(body.project_id || body.projectId || "");
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
