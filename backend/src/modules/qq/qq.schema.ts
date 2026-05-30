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

export type QQVerifyEventInput = z.infer<typeof qqVerifyEventSchema>;
export type QQGroupSendInput = z.infer<typeof qqGroupSendSchema>;
export type QQPrivateSendInput = z.infer<typeof qqPrivateSendSchema>;
