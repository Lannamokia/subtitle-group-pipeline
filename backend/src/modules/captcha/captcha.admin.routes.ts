import { Router } from "express";
import { authenticate, requireFullSession, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as controller from "./captcha.controller";
import { createProviderSchema, updatePolicySchema, updateProviderSchema } from "./captcha.schema";

const router = Router();

router.use(authenticate, requireRole("super_admin"));
router.get("/providers", controller.listProfiles);
router.post("/providers", requireFullSession, validateBody(createProviderSchema), controller.createProfile);
router.put("/providers/:id", requireFullSession, validateBody(updateProviderSchema), controller.updateProfile);
router.post("/providers/:id/test", controller.testProfile);
router.post("/providers/:id/activate", controller.activateProfile);
router.post("/providers/:id/rotate-recovery-key", requireFullSession, controller.rotateRecoveryKey);
router.get("/policy", controller.getPolicy);
router.put("/policy", validateBody(updatePolicySchema), controller.updatePolicy);

export default router;
