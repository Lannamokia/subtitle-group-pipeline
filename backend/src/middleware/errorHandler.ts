import { Request, Response, NextFunction } from "express";
import { AppError, errorResponse } from "../utils/response";
import { ZodError } from "zod";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    errorResponse(res, err.message, err.code, err.statusCode, err.details);
    return;
  }

  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    }));
    errorResponse(res, "Validation failed", "VALIDATION_ERROR", 400, details);
    return;
  }

  if (err.name === "PrismaClientKnownRequestError") {
    // Unique constraint violation
    if ((err as unknown as { code: string }).code === "P2002") {
      errorResponse(
        res,
        "Resource already exists",
        "DUPLICATE_ERROR",
        409
      );
      return;
    }
    // Foreign key constraint violation
    if ((err as unknown as { code: string }).code === "P2003") {
      errorResponse(
        res,
        "Referenced resource does not exist",
        "FOREIGN_KEY_ERROR",
        400
      );
      return;
    }
    // Record not found
    if ((err as unknown as { code: string }).code === "P2025") {
      errorResponse(res, "Resource not found", "NOT_FOUND", 404);
      return;
    }
  }

  console.error("Unhandled error:", err);
  errorResponse(res, "Internal server error", "INTERNAL_ERROR", 500);
}

export function notFoundHandler(
  _req: Request,
  res: Response
): void {
  errorResponse(res, "Resource not found", "NOT_FOUND", 404);
}
