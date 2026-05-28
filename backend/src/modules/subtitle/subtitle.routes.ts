import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./subtitle.controller";
import {
  mergeJobQuerySchema,
  createMergeJobSchema,
  createUnitMergeJobSchema,
  conflictQuerySchema,
  resolveConflictSchema,
  reviewSchema,
  createTranslationClaimSchema,
  submitTranslationSchema,
} from "./subtitle.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid ID") });
const projectIdParamSchema = z.object({ projectId: z.string().uuid("Invalid project ID") });
const unitIdParamSchema = z.object({ unitId: z.string().uuid("Invalid unit ID") });
const taskIdParamSchema = z.object({ taskId: z.string().uuid("Invalid task ID") });
const claimIdParamSchema = z.object({ claimId: z.string().uuid("Invalid claim ID") });
const jobIdParamSchema = z.object({ jobId: z.string().uuid("Invalid job ID") });
const conflictIdParamSchema = z.object({ conflictId: z.string().uuid("Invalid conflict ID") });
const fileIdParamSchema = z.object({
  fileId: z.string().uuid("Invalid file ID"),
  otherFileId: z.string().uuid("Invalid other file ID"),
});
const timelineFileIdParamSchema = z.object({ fileId: z.string().uuid("Invalid file ID") });

// ==================== TRANSLATION CLAIMS ====================

// POST /projects/:projectId/units/:unitId/claims - Claim segment
router.post(
  "/projects/:projectId/units/:unitId/claims",
  authenticate,
  validateParams(projectIdParamSchema.merge(unitIdParamSchema)),
  validateBody(createTranslationClaimSchema),
  controller.createTranslationClaim
);

// DELETE /claims/:claimId - Release claim
router.delete(
  "/claims/:claimId",
  authenticate,
  validateParams(claimIdParamSchema),
  controller.releaseTranslationClaim
);

// GET /projects/:projectId/units/:unitId/claims - List claims
router.get(
  "/projects/:projectId/units/:unitId/claims",
  authenticate,
  validateParams(projectIdParamSchema.merge(unitIdParamSchema)),
  controller.getTranslationClaims
);

// GET /claims/:claimId - Get claim by ID
router.get(
  "/claims/:claimId",
  authenticate,
  validateParams(claimIdParamSchema),
  controller.getTranslationClaimById
);

// ==================== TRANSLATION SUBMISSIONS ====================

// POST /tasks/:taskId/submissions - Submit translation
router.post(
  "/tasks/:taskId/submissions",
  authenticate,
  validateParams(taskIdParamSchema),
  validateBody(submitTranslationSchema),
  controller.submitTranslation
);

// GET /tasks/:taskId/submissions - List submissions for a task
router.get(
  "/tasks/:taskId/submissions",
  authenticate,
  validateParams(taskIdParamSchema),
  controller.getSubmissionsByTask
);

// ==================== MERGE JOBS ====================

// POST /units/:unitId/merge-jobs - Create merge job
router.post(
  "/units/:unitId/merge-jobs",
  authenticate,
  validateParams(unitIdParamSchema),
  validateBody(createUnitMergeJobSchema),
  controller.createMergeJob
);

// GET /merge-jobs/:jobId - Get merge status
router.get(
  "/merge-jobs/:jobId",
  authenticate,
  validateParams(jobIdParamSchema),
  controller.getMergeJob
);

// GET /merge-jobs/:jobId/conflicts - List conflicts
router.get(
  "/merge-jobs/:jobId/conflicts",
  authenticate,
  validateParams(jobIdParamSchema),
  controller.getMergeConflicts
);

// Legacy merge job routes
router.get("/merge-jobs", validateQuery(mergeJobQuerySchema), controller.getMergeJobs);
router.post("/merge-jobs", authenticate, validateBody(createMergeJobSchema), controller.createMergeJobLegacy as unknown as Router);
router.patch(
  "/merge-jobs/:id/status",
  authenticate,
  validateParams(idParamSchema),
  validateBody(z.object({ status: z.string(), output_file_id: z.string().optional(), log: z.string().optional() })),
  controller.updateMergeJobStatus
);

// ==================== CONFLICTS ====================

// POST /conflicts/:conflictId/resolve - Resolve conflict (supervisor only)
router.post(
  "/conflicts/:conflictId/resolve",
  authenticate,
  requireRole("supervisor", "super_admin", "group_admin"),
  validateParams(conflictIdParamSchema),
  validateBody(resolveConflictSchema),
  controller.resolveConflict
);

// GET /conflicts/:conflictId - Get conflict detail
router.get(
  "/conflicts/:conflictId",
  authenticate,
  validateParams(conflictIdParamSchema),
  controller.getConflictDetail
);

// Legacy conflict routes
router.get("/conflicts", validateQuery(conflictQuerySchema), controller.getConflicts);
router.get("/conflicts/:id", validateParams(idParamSchema), controller.getConflict);

// ==================== VERSION COMPARISON ====================

// GET /files/:fileId/compare/:otherFileId - Compare versions
router.get(
  "/files/:fileId/compare/:otherFileId",
  authenticate,
  validateParams(fileIdParamSchema),
  controller.compareVersions
);

// GET /files/:fileId/timeline - Get timeline visualization
router.get(
  "/files/:fileId/timeline",
  authenticate,
  validateParams(timelineFileIdParamSchema),
  controller.getTimelineVisualization
);

// ==================== REVIEWS ====================

router.get("/projects/:projectId/reviews", validateParams(projectIdParamSchema), controller.getReviews);
router.post("/reviews", authenticate, validateBody(reviewSchema), controller.createReview);
router.get("/reviews/:id", validateParams(idParamSchema), controller.getReview);
router.patch("/reviews/:id", authenticate, validateParams(idParamSchema), validateBody(reviewSchema.partial()), controller.updateReview);

export default router;
