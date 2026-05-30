import { z } from "zod";
import { BackendType } from "@prisma/client";

export const databaseConfigSchema = z.object({
  provider: z.enum(["sqlite", "mysql", "mariadb", "postgresql"]),
  url: z.string().min(1, "Database URL is required"),
});

export const setupStorageBackendSchema = z.object({
  name: z.string().min(1).max(200),
  backend_type: z.nativeEnum(BackendType),
  config: z.string().min(1),
  quota_bytes: z.number().int().min(0).optional().nullable(),
});

export const initialAdminSchema = z.object({
  username: z.string().min(2).max(50),
  password: z.string().min(8).max(100),
  nickname: z.string().max(100).optional(),
  email: z.string().email().optional(),
});

export const completeSetupSchema = z.object({
  database: databaseConfigSchema,
  admin: initialAdminSchema,
  storage: setupStorageBackendSchema,
});

export type CompleteSetupInput = z.infer<typeof completeSetupSchema>;
