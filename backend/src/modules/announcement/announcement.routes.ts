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
router.post("/", authenticate, requireRole("super_admin", "admin", "moderator"), validateBody(createAnnouncementSchema), controller.createAnnouncement);
router.patch("/:id", authenticate, requireRole("super_admin", "admin", "moderator"), validateParams(idParamSchema), validateBody(updateAnnouncementSchema), controller.updateAnnouncement);
router.delete("/:id", authenticate, requireRole("super_admin", "admin", "moderator"), validateParams(idParamSchema), controller.deleteAnnouncement);

export default router;
