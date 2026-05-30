import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as controller from "./system.controller";
import { updateBrandingSchema } from "./system.schema";

const router = Router();

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowedTypes.join(", ")}`));
    }
  },
});

router.get("/branding", controller.getBranding);
router.put(
  "/branding",
  authenticate,
  requireRole("super_admin"),
  validateBody(updateBrandingSchema),
  controller.updateBranding
);
router.post(
  "/branding/logo",
  authenticate,
  requireRole("super_admin"),
  logoUpload.any(),
  controller.uploadLogo
);
router.get("/logo", controller.getLogo);

export default router;
