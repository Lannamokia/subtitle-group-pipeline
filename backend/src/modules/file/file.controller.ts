import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as fileService from "./file.service";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { env } from "../../config/env";
import path from "path";
import fs from "fs";

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

// POST /projects/:projectId/files - Upload new file
export async function uploadFile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await fileService.uploadFile(req.user!.id, req.body);
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
    const result = await fileService.replaceFile(
      getParam(req, "fileId"),
      req.user!.id,
      req.body
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
      getParam(req, "projectId"),
      req.query as unknown as Parameters<typeof fileService.getProjectFiles>[1]
    );
    successResponse(res, { files: result.files, links: result.links }, 200, result.meta);
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
    const ttl = req.query.ttl ? parseInt(req.query.ttl as string, 10) : 300;
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

    // Get the current version
    const currentVersion = await prisma.fileVersion.findFirst({
      where: {
        file_id: link.file_id,
        is_current: true,
      },
    });

    if (!currentVersion) {
      throw new AppError("No current version available", "NOT_FOUND", 404);
    }

    // Get the storage backend
    const backend = fileEntity.storage_backend_id
      ? await prisma.storageBackend.findUnique({
          where: { id: fileEntity.storage_backend_id },
        })
      : null;

    if (backend?.backend_type === "s3" || backend?.backend_type === "s3_compatible") {
      // For S3, redirect to presigned URL
      const { S3Adapter } = await import("../storage/adapters/s3.adapter");
      const config = JSON.parse(backend.config);
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
    const result = await fileService.createLinkAsset(req.user!.id, req.body);
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
    const result = await fileService.getLinkHistory(getParam(req, "projectId"));
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
