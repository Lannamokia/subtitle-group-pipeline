import { Router } from "express";
import { validateBody } from "../../middleware/validate";
import * as controller from "./setup.controller";
import { completeSetupSchema } from "./setup.schema";

const router = Router();

router.get("/status", controller.getStatus);
router.post("/complete", validateBody(completeSetupSchema), controller.completeSetup);

export default router;
