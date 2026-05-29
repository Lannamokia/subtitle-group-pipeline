import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as wikiService from "./wiki.service";

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

export async function createWiki(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.createWiki(req.user!.id, req.body);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getWikis(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.getWikis(
      req.query as unknown as Parameters<typeof wikiService.getWikis>[0]
    );
    successResponse(res, { wikis: result.wikis }, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getWiki(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.getWikiById(getParam(req, "id"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getWikiBySlug(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.getWikiBySlug(
      req.query.project_id as string | null,
      getParam(req, "slug")
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// Smart handler for GET /wiki/:id - tries project_id first, then falls back to wiki id
export async function getWikiOrByProjectId(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const param = getParam(req, "id");
    // Try to find by project_id first (for frontend compatibility)
    const byProject = await wikiService.getWikiByProjectId(param);
    if (byProject) {
      successResponse(res, byProject);
      return;
    }
    // Fall back to wiki id lookup
    const result = await wikiService.getWikiById(param);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateWiki(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.updateWiki(getParam(req, "id"), req.body, req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function approveWikiChange(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.approveWikiChange(getParam(req, "id"), req.user!.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function rejectWikiChange(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { reason } = req.body;
    const result = await wikiService.rejectWikiChange(getParam(req, "id"), req.user!.id, reason);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteWiki(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.deleteWiki(getParam(req, "id"), req.user?.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

// Comments
export async function createComment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const wikiId = req.params.wikiId as string | undefined;
    const result = await wikiService.createComment(req.user!.id, {
      ...req.body,
      wiki_id: req.body.wiki_id ?? wikiId,
    });
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getComments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.getComments(getParam(req, "wikiId"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateComment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.updateComment(getParam(req, "id"), req.user!.id, req.body.content);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteComment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.deleteComment(getParam(req, "id"), req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
