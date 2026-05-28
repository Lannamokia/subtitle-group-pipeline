import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { AuthenticatedRequest } from "../../middleware/auth";
import * as templateService from "./template.service";

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

export async function createTemplate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await templateService.createTemplate(req.body, req.user?.id);
    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function getTemplates(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await templateService.getTemplates(
      req.query as unknown as Parameters<typeof templateService.getTemplates>[0]
    );
    successResponse(res, result.templates, 200, result.meta);
  } catch (error) {
    next(error);
  }
}

export async function getTemplate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await templateService.getTemplateById(getParam(req, "id"));
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateTemplate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await templateService.updateTemplate(
      getParam(req, "id"),
      req.body,
      req.user?.id
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function deleteTemplate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await templateService.deleteTemplate(
      getParam(req, "id"),
      req.user?.id
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function setDefaultTemplate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await templateService.setDefaultTemplate(
      getParam(req, "id"),
      req.user?.id
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
