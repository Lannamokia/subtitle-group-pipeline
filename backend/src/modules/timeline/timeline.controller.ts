import { Request, Response, NextFunction } from "express";
import { TimelineEventType } from "@prisma/client";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as timelineService from "./timeline.service";

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

export async function getProjectTimeline(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await timelineService.getProjectTimeline(getParam(req, "projectId"), {
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
      event_type: req.query.event_type as TimelineEventType | undefined,
    });
    successResponse(res, result.events, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getGlobalTimeline(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await timelineService.getGlobalTimeline(req.user!.id, {
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    });
    successResponse(res, result.events, 200, result.meta);
  } catch (error) {
    next(error);
  }
}
