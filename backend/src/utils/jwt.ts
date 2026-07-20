import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * JWT payload schema for both access and refresh tokens.
 *
 * `jti` is a per-token unique identifier (UUID v4) used by the server-side
 * revocation list (R9). It is injected automatically by `signToken` /
 * `signRefreshToken`; callers do not supply it.
 */
export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  jti: string;
  sessionType?: "normal" | "recovery";
  exp?: number;
}

/** Claims supplied by callers when signing — `jti` / `exp` are injected inside. */
export type SignableJWTClaims = Omit<JWTPayload, "jti" | "exp">;

const JWT_ALGORITHM: jwt.Algorithm = "HS256";

function getJwtSecret(): string {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET is not configured. Complete setup first.");
  }
  return env.JWT_SECRET;
}

/**
 * Resolve the secret used to sign / verify refresh tokens.
 *
 * Falls back to `JWT_SECRET` when `JWT_REFRESH_SECRET` is unset or too short,
 * preserving backward compatibility with existing single-secret deployments
 * (R9 AC5: separate secrets are an evaluation item, default is fallback).
 */
function getJwtRefreshSecret(): string {
  const refreshSecret = env.JWT_REFRESH_SECRET;
  if (refreshSecret && refreshSecret.length >= 32) {
    return refreshSecret;
  }
  return getJwtSecret();
}

export function signToken(claims: SignableJWTClaims): string {
  const payload: JWTPayload = { ...claims, jti: crypto.randomUUID() };
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(claims: SignableJWTClaims): string {
  const payload: JWTPayload = { ...claims, jti: crypto.randomUUID() };
  return jwt.sign(payload, getJwtRefreshSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function signRecoveryToken(claims: Omit<SignableJWTClaims, "sessionType">): string {
  const payload: JWTPayload = {
    ...claims,
    sessionType: "recovery",
    jti: crypto.randomUUID(),
  };
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: "10m",
  });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: [JWT_ALGORITHM],
  }) as JWTPayload;
}

/**
 * Verify a refresh token using the dedicated refresh secret (which may equal
 * `JWT_SECRET` when `JWT_REFRESH_SECRET` is not configured).
 *
 * Existing callers in `auth.service.ts` still use `verifyToken` for refresh
 * tokens; task 11.3 wires them to this helper as part of the rotation /
 * revocation flow.
 */
export function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, getJwtRefreshSecret(), {
    algorithms: [JWT_ALGORITHM],
  }) as JWTPayload;
}
