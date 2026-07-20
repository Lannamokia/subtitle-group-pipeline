import crypto from "crypto";
import { env } from "../../config/env";

const ENCRYPTION_INFO = Buffer.from("subtitle-group-pipeline/captcha-provider/v1");
const DIGEST_INFO = Buffer.from("subtitle-group-pipeline/captcha-digest/v1");

function deriveKey(info: Buffer): Buffer {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET is not configured. Complete setup first.");
  }
  return Buffer.from(crypto.hkdfSync("sha256", env.JWT_SECRET, Buffer.alloc(0), info, 32));
}

export function encryptConfig(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(ENCRYPTION_INFO), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptConfig<T>(value: string): T {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted captcha configuration");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(ENCRYPTION_INFO),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function secureDigest(value: string): string {
  return crypto.createHmac("sha256", deriveKey(DIGEST_INFO)).update(value).digest("base64url");
}

export function opaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function generateRecoveryKey(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  while (true) {
    const bytes = crypto.randomBytes(32);
    let key = "";
    for (const byte of bytes) key += alphabet[byte % alphabet.length];
    if (/[a-z]/.test(key) && /\d/.test(key)) return key;
  }
}

export async function hashRecoveryKey(key: string, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(key, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
  return { salt, hash: hash.toString("base64url") };
}

export async function verifyRecoveryKey(key: string, salt: string, expected: string): Promise<boolean> {
  const candidate = await hashRecoveryKey(key, salt);
  const left = Buffer.from(candidate.hash, "base64url");
  const right = Buffer.from(expected, "base64url");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}
