import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: process.env.ENV_FILE_PATH || undefined });

/**
 * Default trusted proxy CIDR ranges used when TRUSTED_PROXY_CIDRS is not set.
 *
 * Covers:
 *   - Loopback (IPv4 + IPv6) for local Caddy/Nginx running on the same host
 *   - RFC1918 private ranges for internal reverse proxies on the LAN
 *   - Cloudflare's published IPv4 + IPv6 edge ranges (https://www.cloudflare.com/ips/)
 *
 * Operators deploying behind a different proxy stack should override the env var.
 * Cloudflare ranges are baked in as a static snapshot; review periodically.
 */
const DEFAULT_TRUSTED_PROXY_CIDRS = [
  // Loopback
  "127.0.0.0/8",
  "::1/128",
  // RFC1918 private networks (internal reverse proxies)
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  // Cloudflare IPv4 (https://www.cloudflare.com/ips-v4)
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  // Cloudflare IPv6 (https://www.cloudflare.com/ips-v6)
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
].join(",");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ENV_FILE_PATH: z.string().optional(),
  PORT: z.string().default("3000").transform(Number),
  DATABASE_URL: z.string().default("file:./dev.db"),
  DATABASE_AUTO_UPGRADE: z
    .string()
    .optional()
    .default("true")
    .transform((value) => value !== "false" && value !== "0"),
  JWT_SECRET: z.string().optional().default(""),
  // Optional independent secret for refresh tokens (R9 AC5). When unset or
  // shorter than 32 chars, signing/verification falls back to JWT_SECRET so
  // existing single-secret deployments keep working unchanged.
  JWT_REFRESH_SECRET: z.string().optional().default(""),
  JWT_EXPIRES_IN: z.string().default("24h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_ROUNDS: z.string().default("12").transform(Number),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .refine((value) => value.trim() !== "*", {
      message: "CORS_ORIGIN must not be '*'; set an explicit origin",
    }),
  UPLOAD_MAX_SIZE: z.string().default("536870912000").transform(Number), // 500GB
  UPLOAD_DIR: z.string().default("./uploads"),
  API_PREFIX: z.string().default("/api/v1"),

  // Reverse proxy / trust proxy configuration (R5)
  // Number of proxy hops in front of Express (e.g. Caddy=1, Cloudflare+Caddy=2).
  // Used by `app.set('trust proxy', N)` so req.ip resolves to the real client.
  TRUST_PROXY_HOPS: z
    .string()
    .default("1")
    .transform((value) => {
      const parsed = parseInt(value, 10);
      return parsed;
    })
    .pipe(z.number().int().nonnegative()),

  // Comma-separated CIDR list of proxies allowed to inject client-IP headers
  // (cf-connecting-ip, true-client-ip). Headers from any other source are
  // ignored to prevent attackers from spoofing the real client IP.
  TRUSTED_PROXY_CIDRS: z
    .string()
    .default(DEFAULT_TRUSTED_PROXY_CIDRS)
    .transform((value) =>
      value
        .split(",")
        .map((cidr) => cidr.trim())
        .filter((cidr) => cidr.length > 0)
    ),

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
