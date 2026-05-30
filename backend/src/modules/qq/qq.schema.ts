import { z } from "zod";

export const qqVerifyEventSchema = z.object({
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  qq_number: z.string().optional(),
  qq_group: z.string().optional(),
  group_id: z.union([z.string(), z.number()]).optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
});

export const qqGroupSendSchema = z.object({
  group_id: z.union([z.string(), z.number()]),
  message: z.string().min(1),
  at_users: z.array(z.union([z.string(), z.number()])).optional().default([]),
});

export const qqPrivateSendSchema = z.object({
  user_id: z.union([z.string(), z.number()]),
  message: z.string().min(1),
});

export const qqHeartbeatSchema = z.object({
  status: z.string().trim().max(50).optional(),
  connected: z.boolean().optional(),
  bot_id: z.union([z.string(), z.number()]).optional().nullable(),
  bot_nickname: z.string().trim().max(120).optional().nullable(),
  error: z.string().trim().max(1000).optional().nullable(),
  adapter: z.string().trim().max(80).optional().nullable(),
  version: z.string().trim().max(80).optional().nullable(),
});

export type QQVerifyEventInput = z.infer<typeof qqVerifyEventSchema>;
export type QQGroupSendInput = z.infer<typeof qqGroupSendSchema>;
export type QQPrivateSendInput = z.infer<typeof qqPrivateSendSchema>;
export type QQHeartbeatInput = z.infer<typeof qqHeartbeatSchema>;
