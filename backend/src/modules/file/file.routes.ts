import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./file.controller";
import {
  fileQuerySchema,
  createLinkSchema,
  updateUploadPolicySchema,
  downloadLinkQuerySchema,
  batchAssignTasksSchema,
  batchArchiveUnitsSchema,
} from "./file.schema";
import { z } from "zod";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

const fileIdParamSchema = z.object({ fileId: z.string().uuid("Invalid file ID") });
const versionIdParamSchema = z.object({
  fileId: z.string().uuid("Invalid file ID"),
  versionId: z.string().uuid("Invalid version ID"),
});
const projectIdParamSchema = z.object({ projectId: z.string().uuid("Invalid project ID") });
const projectIdQuerySchema = z.object({ project_id: z.string().uuid("Invalid project ID") });

// Static and collection routes must stay before /:fileId.
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

router.post(
  "/upload",
  authenticate,
  upload.single("file"),
  controller.uploadFile
);

router.post(
  "/",
  authenticate,
  upload.single("file"),
  controller.uploadFile
);

router.get(
  "/",
  authenticate,
  validateQuery(fileQuerySchema),
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
  validateQuery(projectIdQuerySchema.partial().extend({ projectId: z.string().uuid("Invalid project ID").optional() })),
  controller.getLinks
);

router.delete(
  "/links/:linkId",
  authenticate,
  validateParams(z.object({ linkId: z.string().uuid("Invalid link ID") })),
  controller.deleteLink
);

router.post(
  "/batch/assign-tasks",
  authenticate,
  requireRole("super_admin", "group_admin", "supervisor"),
  validateBody(batchAssignTasksSchema),
  controller.batchAssignTasks
);

router.post(
  "/batch/archive-units",
  authenticate,
  requireRole("super_admin", "group_admin", "supervisor"),
  validateBody(batchArchiveUnitsSchema),
  controller.batchArchiveUnits
);

// Project-scoped file bucket routes.
router.post(
  "/projects/:projectId/files",
  authenticate,
  validateParams(projectIdParamSchema),
  upload.single("file"),
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
  upload.single("file"),
  controller.replaceFile
);

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

// Compatibility routes for callers that include an extra /files prefix.
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

router.get(
  "/files/:fileId/download",
  authenticate,
  validateParams(fileIdParamSchema),
  validateQuery(downloadLinkQuerySchema),
  controller.getDownloadLink
);

router.post(
  "/files/:fileId/download",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.getDownloadLink
);

// Actual download (token-based, no auth required for the link itself)
router.get("/download/:token", controller.downloadByToken);

// File entity routes.
router.post(
  "/:fileId/replace",
  authenticate,
  validateParams(fileIdParamSchema),
  upload.single("file"),
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

router.get(
  "/:fileId/download",
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

router.post(
  "/:fileId/download",
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

export default router;
