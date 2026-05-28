import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./timeline.controller";
import { z } from "zod";

const router = Router();

const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
});

const timelineQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("50"),
});

router.get(
  "/project/:projectId",
  authenticate,
  validateParams(projectIdParamSchema),
  validateQuery(timelineQuerySchema),
  controller.getProjectTimeline
);

router.get(
  "/global",
  authenticate,
  validateQuery(timelineQuerySchema),
  controller.getGlobalTimeline
);

export default router;
