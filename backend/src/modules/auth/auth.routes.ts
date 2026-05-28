import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as controller from "./auth.controller";
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  updateProfileSchema,
} from "./auth.schema";

const router = Router();

router.post("/register", validateBody(registerSchema), controller.register);
router.post("/login", validateBody(loginSchema), controller.login);
router.get("/me", authenticate, controller.me);
router.patch(
  "/password",
  authenticate,
  validateBody(changePasswordSchema),
  controller.changePassword
);
router.patch(
  "/profile",
  authenticate,
  validateBody(updateProfileSchema),
  controller.updateProfile
);

export default router;
