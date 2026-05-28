import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as wikiService from "./wiki.service";

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
    const result = await wikiService.getWikis(req.query as unknown as Parameters<typeof wikiService.getWikis>[0]);
    successResponse(res, result.wikis, 200, result.meta);
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
    const result = await wikiService.getWikiById(req.params.id);
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
      req.params.slug
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateWiki(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.updateWiki(req.params.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function approveWiki(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.approveWiki(req.params.id, req.user!.id, req.body);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteWiki(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await wikiService.deleteWiki(req.params.id);
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
    const result = await wikiService.createComment(req.user!.id, req.body);
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
    const result = await wikiService.getComments(req.params.wikiId);
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
    const result = await wikiService.updateComment(req.params.id, req.user!.id, req.body.content);
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
    const result = await wikiService.deleteComment(req.params.id, req.user!.id);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
