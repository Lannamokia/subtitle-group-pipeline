import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./file.controller";
import {
  fileQuerySchema,
  createFileSchema,
  createVersionSchema,
  createLinkSchema,
  updateUploadPolicySchema,
} from "./file.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid file ID") });
const versionParamSchema = z.object({
  id: z.string().uuid("Invalid file ID"),
  versionId: z.string().uuid("Invalid version ID"),
});

router.get("/", validateQuery(fileQuerySchema), controller.getFiles);
router.get("/:id", validateParams(idParamSchema), controller.getFile);
router.post("/", authenticate, validateBody(createFileSchema), controller.createFile);
router.delete("/:id", authenticate, validateParams(idParamSchema), controller.deleteFile);

// Versions
router.post("/:id/versions", authenticate, validateParams(idParamSchema), validateBody(createVersionSchema), controller.createVersion);
router.patch("/:id/versions/:versionId/current", authenticate, validateParams(versionParamSchema), controller.setCurrentVersion);

// Links
router.post("/links", authenticate, validateBody(createLinkSchema), controller.createLink);

// Upload policy
router.get("/upload-policy", validateQuery(z.object({ project_id: z.string().uuid().optional() })), controller.getUploadPolicy);
router.post("/upload-policy", authenticate, validateBody(updateUploadPolicySchema), controller.updateUploadPolicy);

export default router;
