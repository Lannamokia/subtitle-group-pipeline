import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as announcementService from "./announcement.service";

export async function createAnnouncement(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await announcementService.createAnnouncement(req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getAnnouncements(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await announcementService.getAnnouncements(req.query as unknown as Parameters<typeof announcementService.getAnnouncements>[0]);
    successResponse(res, result.announcements, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await announcementService.getAnnouncementById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await announcementService.updateAnnouncement(req.params.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await announcementService.deleteAnnouncement(req.params.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
