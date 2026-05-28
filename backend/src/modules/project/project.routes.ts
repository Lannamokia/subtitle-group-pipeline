import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./project.controller";
import {
  createProjectSchema,
  createProjectFromTemplateSchema,
  updateProjectSchema,
  projectQuerySchema,
  addMemberSchema,
  updateMemberSchema,
  createUnitSchema,
  joinRequestSchema,
  updateJoinRequestSchema,
} from "./project.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid project ID") });
const requestIdParamSchema = z.object({ requestId: z.string().uuid("Invalid request ID") });
const userIdParamSchema = z.object({ userId: z.string().uuid("Invalid user ID") });

// Public routes
router.get("/", validateQuery(projectQuerySchema), controller.getProjects);
router.get("/:id", validateParams(idParamSchema), controller.getProject);

// Project creation
router.post("/", authenticate, validateBody(createProjectSchema), controller.createProject);
router.post(
  "/from-template",
  authenticate,
  validateBody(createProjectFromTemplateSchema),
  controller.createProjectFromTemplate
);

// Project management
router.patch("/:id", authenticate, validateParams(idParamSchema), validateBody(updateProjectSchema), controller.updateProject);
router.post("/:id/archive", authenticate, validateParams(idParamSchema), controller.archiveProject);
router.post("/:id/unarchive", authenticate, validateParams(idParamSchema), controller.unarchiveProject);
router.post("/:id/delete", authenticate, validateParams(idParamSchema), controller.softDeleteProject);
router.post("/:id/restore", authenticate, validateParams(idParamSchema), controller.restoreProject);

// Members
router.get("/:id/members", validateParams(idParamSchema), controller.getProjectMembers);
router.post("/:id/members", authenticate, validateParams(idParamSchema), validateBody(addMemberSchema), controller.addMember);
router.patch("/:id/members/:userId", authenticate, validateParams(z.object({ id: z.string().uuid(), userId: z.string().uuid() })), validateBody(updateMemberSchema), controller.updateMember);
router.delete("/:id/members/:userId", authenticate, validateParams(z.object({ id: z.string().uuid(), userId: z.string().uuid() })), controller.removeMember);

// Units
router.post("/:id/units", authenticate, validateParams(idParamSchema), validateBody(createUnitSchema), controller.createUnit);

// Join requests
router.get("/:id/join-requests", authenticate, validateParams(idParamSchema), controller.getJoinRequests);
router.post("/:id/join", authenticate, validateParams(idParamSchema), validateBody(joinRequestSchema), controller.joinRequest);
router.post("/join-requests/:requestId/respond", authenticate, validateParams(requestIdParamSchema), validateBody(updateJoinRequestSchema), controller.respondJoinRequest);

export default router;
