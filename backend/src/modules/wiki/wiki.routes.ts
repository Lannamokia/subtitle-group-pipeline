import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./wiki.controller";
import {
  createWikiSchema,
  updateWikiSchema,
  wikiQuerySchema,
  approveWikiSchema,
  createCommentSchema,
} from "./wiki.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid wiki ID") });
const wikiIdParamSchema = z.object({ wikiId: z.string().uuid("Invalid wiki ID") });
const slugParamSchema = z.object({ slug: z.string().min(1) });

router.get("/", validateQuery(wikiQuerySchema), controller.getWikis);
router.get("/by-slug/:slug", validateParams(slugParamSchema), controller.getWikiBySlug);
router.get("/:id", validateParams(idParamSchema), controller.getWiki);
router.post("/", authenticate, validateBody(createWikiSchema), controller.createWiki);
router.patch("/:id", authenticate, validateParams(idParamSchema), validateBody(updateWikiSchema), controller.updateWiki);
router.post("/:id/approve", authenticate, requireRole("admin", "super_admin", "moderator"), validateParams(idParamSchema), validateBody(approveWikiSchema), controller.approveWiki);
router.delete("/:id", authenticate, requireRole("admin", "super_admin", "moderator"), validateParams(idParamSchema), controller.deleteWiki);

// Comments
router.get("/:wikiId/comments", validateParams(wikiIdParamSchema), controller.getComments);
router.post("/comments", authenticate, validateBody(createCommentSchema), controller.createComment);
router.patch("/comments/:id", authenticate, validateParams(idParamSchema), validateBody(z.object({ content: z.string().min(1) })), controller.updateComment);
router.delete("/comments/:id", authenticate, validateParams(idParamSchema), controller.deleteComment);

export default router;
