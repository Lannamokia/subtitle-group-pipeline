import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./file.controller";
import {
  fileQuerySchema,
  uploadFileSchema,
  replaceFileSchema,
  createLinkSchema,
  updateUploadPolicySchema,
  downloadLinkQuerySchema,
} from "./file.schema";
import { z } from "zod";

const router = Router();

const fileIdParamSchema = z.object({ fileId: z.string().uuid("Invalid file ID") });
const versionIdParamSchema = z.object({
  fileId: z.string().uuid("Invalid file ID"),
  versionId: z.string().uuid("Invalid version ID"),
});
const projectIdParamSchema = z.object({ projectId: z.string().uuid("Invalid project ID") });

// Project-scoped file routes
router.post(
  "/projects/:projectId/files",
  authenticate,
  validateParams(projectIdParamSchema),
  validateBody(uploadFileSchema),
  controller.uploadFile
);

router.get(
  "/projects/:projectId/files",
  authenticate,
  validateParams(projectIdParamSchema),
  validateQuery(fileQuerySchema),
  controller.getProjectFiles
);

router.post(
  "/projects/:projectId/files/:fileId/replace",
  authenticate,
  validateParams(z.object({
    projectId: z.string().uuid("Invalid project ID"),
    fileId: z.string().uuid("Invalid file ID"),
  })),
  validateBody(replaceFileSchema),
  controller.replaceFile
);

// File detail routes
router.get(
  "/files/:fileId",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.getFile
);

router.delete(
  "/files/:fileId",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.deleteFile
);

// Version routes
router.get(
  "/files/:fileId/versions",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.getFileVersions
);

router.post(
  "/files/:fileId/versions/:versionId/approve",
  authenticate,
  validateParams(versionIdParamSchema),
  controller.approveVersion
);

// Download link
router.get(
  "/files/:fileId/download",
  authenticate,
  validateParams(fileIdParamSchema),
  validateQuery(downloadLinkQuerySchema),
  controller.getDownloadLink
);

// Actual download (token-based, no auth required for the link itself)
router.get("/download/:token", controller.downloadByToken);

// Link asset routes
router.post(
  "/projects/:projectId/links",
  authenticate,
  validateParams(projectIdParamSchema),
  validateBody(createLinkSchema),
  controller.createLink
);

router.get(
  "/projects/:projectId/links",
  authenticate,
  validateParams(projectIdParamSchema),
  controller.getLinks
);

// Upload policy routes
router.get(
  "/upload-policy",
  validateQuery(z.object({ project_id: z.string().uuid().optional() })),
  controller.getUploadPolicy
);

router.post(
  "/upload-policy",
  authenticate,
  requireRole("super_admin", "group_admin", "supervisor"),
  validateBody(updateUploadPolicySchema),
  controller.updateUploadPolicy
);

export default router;
