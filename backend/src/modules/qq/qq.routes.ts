import { Router } from "express";
import { validateBody } from "../../middleware/validate";
import * as controller from "./qq.controller";
import { qqGroupSendSchema, qqPrivateSendSchema, qqVerifyEventSchema } from "./qq.schema";

const router = Router();

router.post("/verify", validateBody(qqVerifyEventSchema), controller.verifyQQEvent);
router.post("/send-group", validateBody(qqGroupSendSchema), controller.sendGroupQQMessage);
router.post("/send-private", validateBody(qqPrivateSendSchema), controller.sendPrivateQQMessage);

export default router;
