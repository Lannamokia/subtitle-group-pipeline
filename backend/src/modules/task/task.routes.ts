import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./task.controller";
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
  claimSegmentSchema,
  submitTranslationSchema,
  createDependencySchema,
} from "./task.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid task ID") });
const depParamSchema = z.object({
  id: z.string().uuid("Invalid task ID"),
  dependencyId: z.string().uuid("Invalid dependency ID"),
});

router.get("/", validateQuery(taskQuerySchema), controller.getTasks);
router.get("/:id", validateParams(idParamSchema), controller.getTask);
router.post("/", authenticate, validateBody(createTaskSchema), controller.createTask);
router.patch("/:id", authenticate, validateParams(idParamSchema), validateBody(updateTaskSchema), controller.updateTask);
router.delete("/:id", authenticate, validateParams(idParamSchema), controller.deleteTask);

// Translation claiming
router.post("/:id/claim", authenticate, validateParams(idParamSchema), validateBody(claimSegmentSchema), controller.claimSegment);
router.post("/:id/submit", authenticate, validateParams(idParamSchema), validateBody(submitTranslationSchema), controller.submitTranslation);

// Dependencies
router.post("/:id/dependencies", authenticate, validateParams(idParamSchema), validateBody(createDependencySchema), controller.createDependency);
router.delete("/:id/dependencies/:dependencyId", authenticate, validateParams(depParamSchema), controller.removeDependency);

export default router;
