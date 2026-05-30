import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import * as setupService from "./setup.service";

export async function getStatus(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    successResponse(res, await setupService.getSetupStatus());
  } catch (error) {
    next(error);
  }
}

export async function completeSetup(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    successResponse(res, await setupService.completeSetup(req.body), 201);
  } catch (error) {
    next(error);
  }
}
