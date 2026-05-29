import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./storage.controller";
import {
  createStorageBackendSchema,
  updateStorageBackendSchema,
  storageQuerySchema,
} from "./storage.schema";
import { z } from "zod";

const router = Router();

// Multer configuration for avatar upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowedTypes.join(", ")}`));
    }
  },
});

const idParamSchema = z.object({ id: z.string().uuid("Invalid backend ID") });

router.get("/", validateQuery(storageQuerySchema), controller.getBackends);
router.get("/default", controller.getDefaultBackend);
router.get("/:id", validateParams(idParamSchema), controller.getBackend);
router.post("/", authenticate, requireRole("super_admin", "group_admin"), validateBody(createStorageBackendSchema), controller.createBackend);
router.patch("/:id", authenticate, requireRole("super_admin", "group_admin"), validateParams(idParamSchema), validateBody(updateStorageBackendSchema), controller.updateBackend);
router.delete("/:id", authenticate, requireRole("super_admin", "group_admin"), validateParams(idParamSchema), controller.deleteBackend);

// Backward-compatible aliases for tests and older clients using /storage/backends.
router.get("/backends", validateQuery(storageQuerySchema), controller.getBackends);
router.get("/backends/default", controller.getDefaultBackend);
router.get("/backends/:id", validateParams(idParamSchema), controller.getBackend);
router.post("/backends", authenticate, requireRole("super_admin", "group_admin"), validateBody(createStorageBackendSchema), controller.createBackend);
router.put("/backends/:id", authenticate, requireRole("super_admin", "group_admin"), validateParams(idParamSchema), validateBody(updateStorageBackendSchema), controller.updateBackend);
router.patch("/backends/:id", authenticate, requireRole("super_admin", "group_admin"), validateParams(idParamSchema), validateBody(updateStorageBackendSchema), controller.updateBackend);
router.delete("/backends/:id", authenticate, requireRole("super_admin", "group_admin"), validateParams(idParamSchema), controller.deleteBackend);

// Avatar upload endpoint
router.post("/avatar", authenticate, upload.single("avatar"), controller.uploadAvatar);

export default router;
