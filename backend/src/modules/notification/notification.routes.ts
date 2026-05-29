import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./notification.controller";
import {
  notificationQuerySchema,
  markReadSchema,
  updatePreferencesSchema,
} from "./notification.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid notification ID") });

router.get("/", authenticate, validateQuery(notificationQuerySchema), controller.getNotifications);
router.get("/unread-count", authenticate, controller.getUnreadCount);
router.post("/:id/read", authenticate, validateParams(idParamSchema), controller.markAsRead);
router.post("/read-all", authenticate, controller.markAllAsRead);
router.delete("/:id", authenticate, validateParams(idParamSchema), controller.dismissNotification);
router.get("/preferences", authenticate, controller.getPreferences);
router.put("/preferences", authenticate, validateBody(updatePreferencesSchema), controller.updatePreferences);

// Backward-compatible aliases for tests and older clients.
router.put("/:id/read", authenticate, validateParams(idParamSchema), controller.markAsRead);
router.put("/read-all", authenticate, controller.markAllAsRead);
router.put("/:id/dismiss", authenticate, validateParams(idParamSchema), controller.dismissNotification);

export default router;
