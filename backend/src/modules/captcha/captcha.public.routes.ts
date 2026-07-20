import { Router } from "express";
import { validateBody } from "../../middleware/validate";
import * as controller from "./captcha.controller";
import {
  completeAttemptSchema,
  createAttemptSchema,
  outageTicketSchema,
  recoveryLoginSchema,
} from "./captcha.schema";

const router = Router();

router.get("/public-config", controller.publicConfig);
router.post("/attempts", validateBody(createAttemptSchema), controller.createAttempt);
router.post("/attempts/:id/complete", validateBody(completeAttemptSchema), controller.completeAttempt);
router.post("/outage-ticket", validateBody(outageTicketSchema), controller.outageTicket);
router.post("/recovery-login", validateBody(recoveryLoginSchema), controller.recoveryLogin);

export default router;
