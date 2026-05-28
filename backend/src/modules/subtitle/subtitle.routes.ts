import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./subtitle.controller";
import {
  mergeJobQuerySchema,
  createMergeJobSchema,
  conflictQuerySchema,
  resolveConflictSchema,
  reviewSchema,
} from "./subtitle.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid ID") });
const projectIdParamSchema = z.object({ projectId: z.string().uuid("Invalid project ID") });

// Merge Jobs
router.get("/merge-jobs", validateQuery(mergeJobQuerySchema), controller.getMergeJobs);
router.post("/merge-jobs", authenticate, validateBody(createMergeJobSchema), controller.createMergeJob);
router.get("/merge-jobs/:id", validateParams(idParamSchema), controller.getMergeJob);
router.patch("/merge-jobs/:id/status", authenticate, validateParams(idParamSchema), validateBody(z.object({ status: z.string(), output_file_id: z.string().optional(), log: z.string().optional() })), controller.updateMergeJobStatus);

// Conflicts
router.get("/conflicts", validateQuery(conflictQuerySchema), controller.getConflicts);
router.get("/conflicts/:id", validateParams(idParamSchema), controller.getConflict);
router.patch("/conflicts/:id/resolve", authenticate, validateParams(idParamSchema), validateBody(resolveConflictSchema), controller.resolveConflict);

// Reviews
router.get("/projects/:projectId/reviews", validateParams(projectIdParamSchema), controller.getReviews);
router.post("/reviews", authenticate, validateBody(reviewSchema), controller.createReview);
router.get("/reviews/:id", validateParams(idParamSchema), controller.getReview);
router.patch("/reviews/:id", authenticate, validateParams(idParamSchema), validateBody(reviewSchema.partial()), controller.updateReview);

export default router;
