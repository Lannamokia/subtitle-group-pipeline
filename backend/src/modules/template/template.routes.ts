import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate";
import * as controller from "./template.controller";
import {
  createTemplateSchema,
  updateTemplateSchema,
  templateQuerySchema,
} from "./template.schema";
import { z } from "zod";

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid("Invalid template ID") });

router.get("/", validateQuery(templateQuerySchema), controller.getTemplates);
router.get("/:id", validateParams(idParamSchema), controller.getTemplate);
router.post("/", authenticate, requireRole("super_admin", "admin"), validateBody(createTemplateSchema), controller.createTemplate);
router.patch("/:id", authenticate, requireRole("super_admin", "admin"), validateParams(idParamSchema), validateBody(updateTemplateSchema), controller.updateTemplate);
router.delete("/:id", authenticate, requireRole("super_admin", "admin"), validateParams(idParamSchema), controller.deleteTemplate);

export default router;
