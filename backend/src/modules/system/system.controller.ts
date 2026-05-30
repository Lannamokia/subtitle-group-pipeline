import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import * as systemService from "./system.service";

export async function getBranding(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    successResponse(res, await systemService.getBrandingSettings());
  } catch (error) {
    next(error);
  }
}

export async function updateBranding(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    successResponse(res, await systemService.updateBrandingSettings(req.body));
  } catch (error) {
    next(error);
  }
}

export async function uploadLogo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files;
    const uploadedFile =
      req.file ||
      (Array.isArray(files) ? files[0] : files ? Object.values(files)[0]?.[0] : undefined);

    if (!uploadedFile) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "No file uploaded" },
      });
      return;
    }

    successResponse(
      res,
      await systemService.uploadLogo(
        uploadedFile.buffer,
        uploadedFile.mimetype,
        uploadedFile.originalname
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function getLogo(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const logo = await systemService.getLogoFile();
    res.setHeader("Content-Type", logo.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(logo.buffer);
  } catch (error) {
    next(error);
  }
}
