import { Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/response";
import { env } from "../../config/env";
import * as authService from "../auth/auth.service";
import { sendGroupMessage, sendPrivateMessage } from "../notification/adapters/qq.adapter";

function ensureBridgeToken(req: Request) {
  if (!env.QQ_BRIDGE_TOKEN) return;

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== env.QQ_BRIDGE_TOKEN) {
    const error = new Error("Invalid QQ bridge token") as Error & { statusCode?: number; code?: string };
    error.statusCode = 401;
    error.code = "UNAUTHORIZED";
    throw error;
  }
}

function extractVerifyCode(body: Record<string, unknown>) {
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (code) return code;

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const match = message.match(/^\/verify\s+([A-Za-z0-9]+)$/);
  return match?.[1] ?? "";
}

function extractResetPassCode(body: Record<string, unknown>) {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const match = message.match(/^\/resetpass\s+([A-Za-z0-9]+)$/);
  return match?.[1] ?? "";
}

export async function verifyQQEvent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureBridgeToken(req);
    const body = req.body as Record<string, unknown>;
    const resetCode = extractResetPassCode(body);
    const code = resetCode || extractVerifyCode(body);
    const qqGroup = body.qq_group ?? body.group_id;
    const qqNumber = body.qq_number ?? body.user_id;

    const payload = {
      code,
      qq_group: qqGroup === undefined || qqGroup === null ? undefined : String(qqGroup),
      qq_number: qqNumber === undefined || qqNumber === null ? undefined : String(qqNumber),
    };
    const result = resetCode
      ? await authService.verifyPasswordResetByQQ(payload)
      : await authService.verifyByQQ(payload);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function sendGroupQQMessage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureBridgeToken(req);
    const body = req.body as Record<string, unknown>;
    const groupId = String(body.group_id);
    const message = String(body.message ?? "");
    const atUsers = Array.isArray(body.at_users)
      ? body.at_users.map((user) => String(user))
      : [];

    const result = await sendGroupMessage({
      groupId,
      content: message,
      atUsers,
    });

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function sendPrivateQQMessage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    ensureBridgeToken(req);
    const body = req.body as Record<string, unknown>;
    const userId = String(body.user_id);
    const message = String(body.message ?? "");

    const result = await sendPrivateMessage({
      userId,
      content: message,
    });

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
