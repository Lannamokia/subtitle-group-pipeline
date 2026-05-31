import { Response } from "express";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
}

export function successResponse<T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  meta?: ApiResponse<T>["meta"]
): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };
  if (meta) {
    response.meta = meta;
  }
  sendJson(res, response, statusCode);
}

export function errorResponse(
  res: Response,
  message: string,
  code: string = "INTERNAL_ERROR",
  statusCode: number = 500,
  details?: unknown
): void {
  const response: ApiResponse = {
    success: false,
    error: {
      code,
      message,
    },
  };
  if (details) {
    response.error!.details = details;
  }
  sendJson(res, response, statusCode);
}

function sendJson<T>(res: Response, payload: T, statusCode: number): void {
  res
    .status(statusCode)
    .type("application/json")
    .send(JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value
    ));
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: string = "INTERNAL_ERROR",
    statusCode: number = 500,
    details?: unknown
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}
