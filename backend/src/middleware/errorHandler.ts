import { Request, Response, NextFunction } from "express";
import { AppError, errorResponse } from "../utils/response";
import { ZodError } from "zod";

function isDatabaseConnectionError(err: Error): boolean {
  const code = (err as unknown as { code?: string }).code;
  const message = err.message || "";

  if (err.name === "PrismaClientInitializationError") return true;
  if (err.name === "PrismaClientRustPanicError") return true;
  if (code && ["P1000", "P1001", "P1002", "P1003", "P1008", "P1010", "P1011", "P1017"].includes(code)) {
    return true;
  }

  return /Can't reach database server|Database server was reached but timed out|Server has closed the connection|Connection terminated|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(message);
}

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
    if (isDatabaseConnectionError(err)) {
      errorResponse(
        res,
        "Database connection error",
        "DATABASE_CONNECTION_ERROR",
        503
      );
      return;
    }

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

  if (isDatabaseConnectionError(err)) {
    errorResponse(
      res,
      "Database connection error",
      "DATABASE_CONNECTION_ERROR",
      503
    );
    return;
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
