import { z } from "zod";
import { BackendType } from "@prisma/client";

export const createStorageBackendSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  backend_type: z.nativeEnum(BackendType),
  config: z.string().min(1, "Config JSON is required"), // JSON string
  is_default: z.boolean().default(false),
  quota_bytes: z.number().int().min(0).optional().nullable(),
});

export const updateStorageBackendSchema = createStorageBackendSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const storageQuerySchema = z.object({
  page: z.string().optional().transform(Number).default("1"),
  pageSize: z.string().optional().transform(Number).default("20"),
  backend_type: z.nativeEnum(BackendType).optional(),
  is_active: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"))
    .default("true"),
});

export type CreateStorageBackendInput = z.infer<typeof createStorageBackendSchema>;
export type UpdateStorageBackendInput = z.infer<typeof updateStorageBackendSchema>;
export type StorageQueryInput = z.infer<typeof storageQuerySchema>;
