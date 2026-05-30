import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000").transform(Number),
  DATABASE_URL: z.string().default("file:./dev.db"),
  JWT_SECRET: z.string().optional().default(""),
  JWT_EXPIRES_IN: z.string().default("24h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_ROUNDS: z.string().default("12").transform(Number),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  UPLOAD_MAX_SIZE: z.string().default("104857600").transform(Number), // 100MB
  UPLOAD_DIR: z.string().default("./uploads"),
  API_PREFIX: z.string().default("/api/v1"),

  // SMTP (optional)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional().transform((v) => v ? parseInt(v, 10) : 587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // NoneBot QQ (optional)
  NONEBOT_HTTP_API: z.string().optional(),
  QQ_BRIDGE_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
