import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as notificationService from "./notification.service";

export async function getNotifications(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await notificationService.getNotifications(
      req.user!.id,
      req.query as unknown as Parameters<typeof notificationService.getNotifications>[1]
    );
    successResponse(
      res,
      { notifications: result.notifications, unreadCount: result.unreadCount },
      200,
      result.meta
    );
  } catch (error) {
    next(error);
  }
}

export async function getUnreadCount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await notificationService.getUnreadCount(req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function markAsRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await notificationService.markAsRead(req.user!.id, req.params.id as string);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function markAllAsRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await notificationService.markAllAsRead(req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function dismissNotification(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await notificationService.dismissNotification(req.user!.id, req.params.id as string);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getPreferences(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await notificationService.getNotificationPreferences(req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updatePreferences(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await notificationService.updateNotificationPreferences(req.user!.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
