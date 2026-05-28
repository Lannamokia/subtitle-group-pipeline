import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./announcement.controller";
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  announcementQuerySchema,
} from "./announcement.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid announcement ID") });

router.get("/", validateQuery(announcementQuerySchema), controller.getAnnouncements);
router.get("/:id", validateParams(idParamSchema), controller.getAnnouncement);
router.post(
  "/",
  authenticate,
  requireRole("super_admin", "group_admin", "supervisor"),
  validateBody(createAnnouncementSchema),
  controller.createAnnouncement
);
router.put(
  "/:id",
  authenticate,
  validateParams(idParamSchema),
  validateBody(updateAnnouncementSchema),
  controller.updateAnnouncement
);
router.delete(
  "/:id",
  authenticate,
  validateParams(idParamSchema),
  controller.deleteAnnouncement
);
router.post(
  "/:id/pin",
  authenticate,
  validateParams(idParamSchema),
  controller.pinAnnouncement
);

export default router;
