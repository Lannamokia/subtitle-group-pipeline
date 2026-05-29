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
const projectIdQuerySchema = z.object({ project_id: z.string().uuid("Invalid project ID") });

// Compatibility routes mounted under /api/v1/files
router.post(
  "/upload",
  authenticate,
  validateBody(uploadFileSchema),
  controller.uploadFile
);

router.get(
  "/",
  authenticate,
  validateQuery(fileQuerySchema.extend({ project_id: z.string().uuid("Invalid project ID") })),
  controller.getProjectFiles
);

router.post(
  "/links",
  authenticate,
  validateBody(createLinkSchema),
  controller.createLink
);

router.get(
  "/links",
  authenticate,
  validateQuery(projectIdQuerySchema),
  controller.getLinks
);

router.post(
  "/:fileId/replace",
  authenticate,
  validateParams(fileIdParamSchema),
  validateBody(replaceFileSchema),
  controller.replaceFile
);

router.get(
  "/:fileId/versions",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.getFileVersions
);

router.post(
  "/:fileId/versions/:versionId/approve",
  authenticate,
  validateParams(versionIdParamSchema),
  controller.approveVersion
);

router.get(
  "/:fileId/download-link",
  authenticate,
  validateParams(fileIdParamSchema),
  validateQuery(downloadLinkQuerySchema),
  controller.getDownloadLink
);

router.post(
  "/:fileId/download-link",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.getDownloadLink
);

router.get(
  "/:fileId",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.getFile
);

router.delete(
  "/:fileId",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.deleteFile
);

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

// Compatibility routes for frontend calling /links directly
router.post("/links", authenticate, validateBody(createLinkSchema), controller.createLink);
router.delete("/links/:linkId", authenticate, validateParams(z.object({ linkId: z.string().uuid("Invalid link ID") })), controller.deleteLink);

// Compatibility route: POST /files/:fileId/download (frontend uses POST)
router.post("/files/:fileId/download", authenticate, validateParams(fileIdParamSchema), controller.getDownloadLink);

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
