import { Router } from "express";
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

const idParamSchema = z.object({ id: z.string().uuid("Invalid backend ID") });

router.get("/", validateQuery(storageQuerySchema), controller.getBackends);
router.get("/default", controller.getDefaultBackend);
router.get("/:id", validateParams(idParamSchema), controller.getBackend);
router.post("/", authenticate, requireRole("super_admin", "admin"), validateBody(createStorageBackendSchema), controller.createBackend);
router.patch("/:id", authenticate, requireRole("super_admin", "admin"), validateParams(idParamSchema), validateBody(updateStorageBackendSchema), controller.updateBackend);
router.delete("/:id", authenticate, requireRole("super_admin", "admin"), validateParams(idParamSchema), controller.deleteBackend);

export default router;
