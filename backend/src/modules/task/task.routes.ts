import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./task.controller";
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
  claimSegmentSchema,
  submitTranslationSchema,
  createDependencySchema,
  reviewTaskSchema,
  resetTaskSchema,
  updateTaskDeadlineSchema,
} from "./task.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid task ID") });
const depParamSchema = z.object({
  id: z.string().uuid("Invalid task ID"),
  dependencyId: z.string().uuid("Invalid dependency ID"),
});
const claimIdParamSchema = z.object({
  id: z.string().uuid("Invalid task ID"),
  claimId: z.string().uuid("Invalid claim ID"),
});
const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
});

// Basic CRUD
router.get("/", validateQuery(taskQuerySchema), controller.getTasks);
router.get("/:id", validateParams(idParamSchema), controller.getTask);
router.post("/", authenticate, validateBody(createTaskSchema), controller.createTask);
router.patch("/:id", authenticate, validateParams(idParamSchema), validateBody(updateTaskSchema), controller.updateTask);
router.delete("/:id", authenticate, validateParams(idParamSchema), controller.deleteTask);

// State transitions
router.post("/:id/claim", authenticate, validateParams(idParamSchema), controller.claimTask);
router.post("/:id/assign", authenticate, validateParams(idParamSchema), validateBody(z.object({ assignee_id: z.string().uuid() })), controller.assignTask);
router.post("/:id/return", authenticate, validateParams(idParamSchema), controller.returnTask);
router.post("/:id/start", authenticate, validateParams(idParamSchema), controller.startTask);
router.post("/:id/submit", authenticate, validateParams(idParamSchema), controller.submitTask);
router.post("/:id/cancel", authenticate, validateParams(idParamSchema), controller.cancelTask);
router.post("/:id/approve", authenticate, validateParams(idParamSchema), validateBody(reviewTaskSchema), controller.approveTask);
router.post("/:id/reject", authenticate, validateParams(idParamSchema), validateBody(reviewTaskSchema), controller.rejectTask);
router.post("/:id/reset", authenticate, validateParams(idParamSchema), validateBody(resetTaskSchema), controller.resetTask);
router.patch("/:id/deadline", authenticate, validateParams(idParamSchema), validateBody(updateTaskDeadlineSchema), controller.updateTaskDeadline);

// Translation claiming
router.post("/:id/claim-segment", authenticate, validateParams(idParamSchema), validateBody(claimSegmentSchema), controller.claimSegment);
router.post("/:id/abandon-segment/:claimId", authenticate, validateParams(claimIdParamSchema), controller.abandonSegment);
router.post("/:id/submit-translation", authenticate, validateParams(idParamSchema), validateBody(submitTranslationSchema), controller.submitTranslation);

// Dependencies
router.post("/:id/dependencies", authenticate, validateParams(idParamSchema), validateBody(createDependencySchema), controller.createDependency);
router.delete("/:id/dependencies/:dependencyId", authenticate, validateParams(depParamSchema), controller.removeDependency);

// Workload dashboard
router.get("/workload/personal", authenticate, controller.getPersonalWorkload);
router.get("/workload/project/:projectId", authenticate, validateParams(projectIdParamSchema), controller.getProjectWorkload);
router.get("/workload/global", authenticate, requireRole("super_admin", "group_admin"), controller.getGlobalWorkload);

export default router;
