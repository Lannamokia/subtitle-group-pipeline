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
    const data = req.body;
    let result;

    if (data.type === "global" || !data.type) {
      result = await announcementService.createGlobalAnnouncement(req.user!.id, data);
    } else {
      result = await announcementService.createProjectAnnouncement(req.user!.id, data);
    }

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
    const result = await announcementService.getAnnouncements(
      req.query as unknown as Parameters<typeof announcementService.getAnnouncements>[0]
    );
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
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await announcementService.updateAnnouncement(
      req.params.id,
      req.user!.id,
      req.user!.role,
      req.body
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteAnnouncement(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await announcementService.deleteAnnouncement(
      req.params.id,
      req.user!.id,
      req.user!.role
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function pinAnnouncement(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const pinned = req.body.pinned ?? true;
    const result = await announcementService.pinAnnouncement(
      req.params.id,
      req.user!.id,
      req.user!.role,
      pinned
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
