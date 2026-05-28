import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./notification.controller";
import { notificationQuerySchema, markReadSchema } from "./notification.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid notification ID") });

router.get("/", authenticate, validateQuery(notificationQuerySchema), controller.getNotifications);
router.get("/unread-count", authenticate, controller.getUnreadCount);
router.post("/mark-read", authenticate, validateBody(markReadSchema), controller.markAsRead);
router.post("/:id/dismiss", authenticate, validateParams(idParamSchema), controller.dismissNotification);

export default router;
