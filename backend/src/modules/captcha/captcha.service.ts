import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { comparePassword } from "../../utils/password";
import { signRecoveryToken } from "../../utils/jwt";
import * as auditService from "../audit/audit.service";
import {
  decryptConfig,
  encryptConfig,
  generateRecoveryKey,
  hashRecoveryKey,
  opaqueToken,
  secureDigest,
  sha256,
  verifyRecoveryKey,
} from "./captcha.crypto";
import { createProvider } from "./captcha.providers";
import { parseProviderConfig } from "./captcha.schema";
import type { CaptchaPolicyLevel, CaptchaProviderHealth, CaptchaProviderType, CaptchaResult } from "./captcha.types";

const ATTEMPT_TTL_MS = 5 * 60 * 1000;
const VERIFICATION_TTL_MS = 5 * 60 * 1000;
const OUTAGE_TICKET_TTL_MS = 5 * 60 * 1000;
const RECOVERY_RATE_WINDOW_MS = 30 * 60 * 1000;
const RECOVERY_RATE_LIMIT = 3;

type ProviderConfig = Record<string, unknown>;

const UNREADABLE_CONFIG_ERROR = "PROVIDER_CONFIG_UNREADABLE";

function readProviderConfig(profile: { type: string; encrypted_config: string }): ProviderConfig {
  const decrypted = decryptConfig<ProviderConfig>(profile.encrypted_config);
  return parseProviderConfig(profile.type as CaptchaProviderType, decrypted) as ProviderConfig;
}

function usernameDigest(username: string): string {
  return secureDigest(`username:${username.trim().toLowerCase()}`);
}

function ipDigest(ip: string): string {
  return secureDigest(`ip:${ip}`);
}

function publicProfile(profile: {
  id: string;
  name: string;
  type: string;
  encrypted_config: string;
  is_active: boolean;
  config_version: number;
  health_status: string | null;
  health_error_code: string | null;
  last_health_check_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  let configurationValid = true;
  let safeConfig: {
    baseUrl?: unknown;
    siteId?: unknown;
    siteKey?: unknown;
    allowedHostnames?: unknown;
    action?: unknown;
    secretConfigured: boolean;
  };
  try {
    const config = readProviderConfig(profile);
    safeConfig = profile.type === "custom"
      ? { baseUrl: config.baseUrl, siteId: config.siteId, secretConfigured: Boolean(config.secret) }
      : {
          siteKey: config.siteKey,
          allowedHostnames: config.allowedHostnames,
          action: config.action,
          secretConfigured: Boolean(config.secretKey),
        };
  } catch {
    configurationValid = false;
    safeConfig = { secretConfigured: false };
  }
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    config: safeConfig,
    configurationValid,
    isActive: profile.is_active,
    configVersion: profile.config_version,
    health: {
      status: configurationValid ? profile.health_status || "unknown" : "misconfigured",
      errorCode: configurationValid ? profile.health_error_code : UNREADABLE_CONFIG_ERROR,
      checkedAt: profile.last_health_check_at,
    },
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export async function getPolicy() {
  return prisma.captchaPolicy.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", enabled: false, level: "medium" },
  });
}

export async function getPublicConfig() {
  const policy = await getPolicy();
  const active = policy.active_provider_id
    ? await prisma.captchaProviderProfile.findUnique({ where: { id: policy.active_provider_id } })
    : null;
  return {
    enabled: policy.enabled,
    level: policy.level,
    configVersion: policy.config_version,
    provider: active ? { type: active.type } : null,
  };
}

export async function createAttempt(input: {
  username: string;
  ip: string;
  parentOrigin: string;
  theme?: "light" | "dark";
  brandColor?: string;
}) {
  const policy = await getPolicy();
  if (!policy.enabled) return { attemptId: null, presentation: { kind: "disabled" as const } };
  if (!policy.active_provider_id) {
    throw new AppError("Captcha provider is unavailable", "CAPTCHA_PROVIDER_UNAVAILABLE", 503);
  }

  const profile = await prisma.captchaProviderProfile.findUnique({ where: { id: policy.active_provider_id } });
  if (!profile || !profile.is_active) {
    throw new AppError("Captcha provider is unavailable", "CAPTCHA_PROVIDER_UNAVAILABLE", 503);
  }

  const digest = usernameDigest(input.username);
  const recentCredentialFailure = await prisma.captchaAttempt.findFirst({
    where: {
      username_digest: digest,
      credentials_failed_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
    },
    orderBy: { credentials_failed_at: "desc" },
  });

  const attempt = await prisma.captchaAttempt.create({
    data: {
      provider_id: profile.id,
      provider_type: profile.type,
      username_digest: digest,
      ip_digest: ipDigest(input.ip),
      config_version: policy.config_version,
      expires_at: new Date(Date.now() + ATTEMPT_TTL_MS),
    },
  });

  try {
    const provider = createProvider(profile.type, decryptConfig(profile.encrypted_config));
    const presentation = await provider.prepare({
      usernameDigest: digest,
      action: "login",
      parentOrigin: input.parentOrigin,
      policyVersion: policy.config_version,
      level: policy.level as CaptchaPolicyLevel,
      credentialFailure: Boolean(recentCredentialFailure),
      theme: input.theme,
      brandColor: input.brandColor,
    });
    if (presentation.kind === "custom_embed") {
      await prisma.captchaAttempt.update({
        where: { id: attempt.id },
        data: { provider_session_ref: presentation.sessionRef },
      });
    }
    return { attemptId: attempt.id, expiresAt: attempt.expires_at, presentation };
  } catch {
    await prisma.$transaction([
      prisma.captchaAttempt.update({
        where: { id: attempt.id },
        data: { status: "failed", failure_code: "PROVIDER_UNAVAILABLE" },
      }),
      prisma.captchaProviderProfile.update({
        where: { id: profile.id },
        data: {
          health_status: "unavailable",
          health_error_code: "PROVIDER_NETWORK",
          last_health_check_at: new Date(),
        },
      }),
    ]);
    throw new AppError("Captcha provider is unavailable", "CAPTCHA_PROVIDER_UNAVAILABLE", 503);
  }
}

export async function completeAttempt(attemptId: string, providerToken: string) {
  const attempt = await prisma.captchaAttempt.findUnique({
    where: { id: attemptId },
    include: { provider: true },
  });
  const policy = await getPolicy();
  if (!attempt || attempt.expires_at <= new Date()) {
    throw new AppError("Captcha attempt expired", "CAPTCHA_ATTEMPT_EXPIRED", 410);
  }
  if (attempt.status !== "pending") {
    throw new AppError("Captcha attempt was already used", "CAPTCHA_ATTEMPT_USED", 409);
  }
  if (!policy.enabled || policy.config_version !== attempt.config_version || policy.active_provider_id !== attempt.provider_id) {
    throw new AppError("Captcha configuration changed", "CAPTCHA_CONFIG_CHANGED", 409);
  }

  const reserved = await prisma.captchaAttempt.updateMany({
    where: { id: attempt.id, status: "pending", expires_at: { gt: new Date() } },
    data: { status: "verifying" },
  });
  if (reserved.count !== 1) {
    throw new AppError("Captcha attempt was already used", "CAPTCHA_ATTEMPT_USED", 409);
  }

  let result: CaptchaResult;
  try {
    const provider = createProvider(attempt.provider_type, decryptConfig(attempt.provider.encrypted_config));
    result = await provider.verify({
      token: providerToken,
      sessionRef: attempt.provider_session_ref || undefined,
      expectedAction: attempt.action,
    });
  } catch {
    await prisma.captchaAttempt.updateMany({
      where: { id: attempt.id, status: "verifying" },
      data: { status: "failed", failure_code: "PROVIDER_UNAVAILABLE" },
    });
    throw new AppError("Captcha provider is unavailable", "CAPTCHA_PROVIDER_UNAVAILABLE", 503);
  }
  if (!result.success) {
    await prisma.captchaAttempt.updateMany({
      where: { id: attempt.id, status: "verifying" },
      data: { status: "failed", failure_code: result.errorCode || "CAPTCHA_REJECTED" },
    });
    if (result.unavailable) {
      await prisma.captchaProviderProfile.update({
        where: { id: attempt.provider_id },
        data: {
          health_status: "unavailable",
          health_error_code: result.errorCode,
          last_health_check_at: new Date(),
        },
      });
      throw new AppError("Captcha provider is unavailable", "CAPTCHA_PROVIDER_UNAVAILABLE", 503);
    }
    throw new AppError("Captcha verification failed", "CAPTCHA_REJECTED", 400);
  }

  const currentPolicy = await getPolicy();
  if (
    !currentPolicy.enabled || currentPolicy.config_version !== attempt.config_version ||
    currentPolicy.active_provider_id !== attempt.provider_id
  ) {
    await prisma.captchaAttempt.updateMany({
      where: { id: attempt.id, status: "verifying" },
      data: { status: "failed", failure_code: "CAPTCHA_CONFIG_CHANGED" },
    });
    throw new AppError("Captcha configuration changed", "CAPTCHA_CONFIG_CHANGED", 409);
  }

  const verificationToken = opaqueToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  const completed = await prisma.captchaAttempt.updateMany({
    where: { id: attempt.id, status: "verifying" },
    data: {
      status: "verified",
      verification_digest: sha256(verificationToken),
      verification_expires_at: expiresAt,
      completed_at: new Date(),
      failure_code: null,
    },
  });
  if (completed.count !== 1) {
    throw new AppError("Captcha attempt was already used", "CAPTCHA_ATTEMPT_USED", 409);
  }
  return { verificationToken, expiresAt };
}

export async function requireVerification(username: string, verificationToken?: string): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const policy = await tx.captchaPolicy.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default", enabled: false, level: "medium" },
    });
    if (!policy.enabled) return null;
    if (!verificationToken) throw new AppError("Captcha verification required", "CAPTCHA_REQUIRED", 400);

    const proofDigest = sha256(verificationToken);
    const attempt = await tx.captchaAttempt.findUnique({ where: { verification_digest: proofDigest } });
    if (
      !attempt ||
      attempt.status !== "verified" ||
      attempt.verification_expires_at === null ||
      attempt.verification_expires_at <= new Date() ||
      attempt.username_digest !== usernameDigest(username) ||
      attempt.config_version !== policy.config_version ||
      attempt.provider_id !== policy.active_provider_id
    ) {
      throw new AppError("Captcha verification is invalid", "CAPTCHA_PROOF_INVALID", 400);
    }
    const consumed = await tx.captchaAttempt.updateMany({
      where: { id: attempt.id, status: "verified", verification_digest: proofDigest },
      data: { status: "consumed", consumed_at: new Date(), verification_digest: null },
    });
    if (consumed.count !== 1) {
      throw new AppError("Captcha verification is invalid", "CAPTCHA_PROOF_INVALID", 400);
    }
    return attempt.id;
  });
}

export async function recordCredentialFailure(attemptId: string | null) {
  if (!attemptId) return;
  await prisma.captchaAttempt.updateMany({
    where: { id: attemptId },
    data: { credentials_failed_at: new Date() },
  });
}

async function checkHealth(profile: { id: string; type: string; encrypted_config: string }) {
  let health: CaptchaProviderHealth;
  try {
    health = await createProvider(profile.type, readProviderConfig(profile)).healthCheck();
  } catch {
    health = {
      status: "misconfigured",
      errorCode: UNREADABLE_CONFIG_ERROR,
      checkedAt: new Date().toISOString(),
    };
  }
  await prisma.captchaProviderProfile.update({
    where: { id: profile.id },
    data: {
      health_status: health.status,
      health_error_code: health.errorCode || null,
      last_health_check_at: new Date(health.checkedAt),
    },
  });
  return health;
}

export async function issueOutageTicket(username: string, ip: string) {
  const policy = await getPolicy();
  if (!policy.enabled || !policy.active_provider_id) {
    throw new AppError("Recovery is not available", "CAPTCHA_RECOVERY_UNAVAILABLE", 503);
  }
  const profile = await prisma.captchaProviderProfile.findUnique({ where: { id: policy.active_provider_id } });
  if (!profile) throw new AppError("Recovery is not available", "CAPTCHA_RECOVERY_UNAVAILABLE", 503);
  const priorConfirmed5xx = profile.health_status === "unavailable" && profile.health_error_code === "PROVIDER_5XX";
  const health = await checkHealth(profile);
  if (health.status === "healthy") {
    throw new AppError("Captcha provider is healthy", "CAPTCHA_PROVIDER_HEALTHY", 409);
  }
  if (health.errorCode === "PROVIDER_5XX" && !priorConfirmed5xx) {
    throw new AppError("Captcha outage is not yet confirmed", "CAPTCHA_OUTAGE_NOT_CONFIRMED", 503);
  }
  const ticket = opaqueToken();
  const expiresAt = new Date(Date.now() + OUTAGE_TICKET_TTL_MS);
  await prisma.captchaOutageTicket.create({
    data: {
      ticket_digest: sha256(ticket),
      username_digest: usernameDigest(username),
      ip_digest: ipDigest(ip),
      provider_id: profile.id,
      config_version: policy.config_version,
      expires_at: expiresAt,
    },
  });
  return { outageTicket: ticket, expiresAt };
}

async function logRecoveryFailure(username: string, ip: string, reasonCode: string) {
  await prisma.captchaRecoveryAttempt.create({
    data: { username_digest: usernameDigest(username), ip_digest: ipDigest(ip), reason_code: reasonCode },
  });
  await auditService.log({
    action: "captcha.recovery_login_failed",
    resource_type: "captcha",
    ip_address: ip,
    new_value: { reasonCode },
  });
}

export async function recoveryLogin(input: {
  username: string;
  password: string;
  recoveryKey: string;
  outageTicket: string;
  ip: string;
  userAgent?: string;
}) {
  const userDigest = usernameDigest(input.username);
  const clientDigest = ipDigest(input.ip);
  const since = new Date(Date.now() - RECOVERY_RATE_WINDOW_MS);
  const count = await prisma.captchaRecoveryAttempt.count({
    where: { username_digest: userDigest, ip_digest: clientDigest, created_at: { gte: since } },
  });
  const deny = async (reason: string): Promise<never> => {
    if (count < RECOVERY_RATE_LIMIT) await logRecoveryFailure(input.username, input.ip, reason);
    throw new AppError("Recovery login failed", "RECOVERY_LOGIN_FAILED", 401);
  };
  if (count >= RECOVERY_RATE_LIMIT) return deny("RATE_LIMITED");

  const policy = await getPolicy();
  const profile = policy.active_provider_id
    ? await prisma.captchaProviderProfile.findUnique({ where: { id: policy.active_provider_id } })
    : null;
  const ticket = await prisma.captchaOutageTicket.findUnique({
    where: { ticket_digest: sha256(input.outageTicket) },
  });
  if (
    !policy.enabled || !profile || !ticket || ticket.used_at || ticket.expires_at <= new Date() ||
    ticket.username_digest !== userDigest || ticket.ip_digest !== clientDigest ||
    ticket.provider_id !== profile.id || ticket.config_version !== policy.config_version
  ) return deny("INVALID_TICKET");

  const health = await checkHealth(profile);
  if (health.status === "healthy") return deny("PROVIDER_RECOVERED");

  const user = await prisma.user.findUnique({ where: { username: input.username } });
  const passwordOk = user ? await comparePassword(input.password, user.password_hash) : false;
  const keyOk = await verifyRecoveryKey(input.recoveryKey, profile.recovery_key_salt, profile.recovery_key_hash);
  if (!user || !passwordOk || !keyOk || user.role !== "super_admin" || user.status !== "active") {
    return deny("INVALID_CREDENTIALS");
  }

  const recorded = await prisma.$transaction(async (tx) => {
    const consumed = await tx.captchaOutageTicket.updateMany({
      where: { id: ticket.id, used_at: null, expires_at: { gt: new Date() } },
      data: { used_at: new Date() },
    });
    if (consumed.count !== 1) return false;
    await tx.captchaRecoveryAttempt.create({
      data: { username_digest: userDigest, ip_digest: clientDigest, success: true, reason_code: "SUCCESS" },
    });
    await tx.auditLog.create({
      data: {
        user_id: user.id,
        action: "captcha.recovery_login",
        resource_type: "captcha",
        ip_address: input.ip,
        user_agent: input.userAgent,
        new_value: JSON.stringify({ restricted: true }),
      },
    });
    return true;
  });
  if (!recorded) return deny("INVALID_TICKET");
  const token = signRecoveryToken({ userId: user.id, username: user.username, role: user.role });
  return {
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      role: user.role,
      status: user.status,
      avatar_url: user.avatar_url,
      qq_number: user.qq_number,
      created_at: user.created_at,
    },
    token,
    restrictedRecovery: true,
  };
}

export async function listProfiles() {
  const profiles = await prisma.captchaProviderProfile.findMany({ orderBy: { created_at: "desc" } });
  return Promise.all(profiles.map(publicProfile));
}

export async function createProfile(input: { name: string; type: CaptchaProviderType; config: ProviderConfig }, actorId: string) {
  const recoveryKey = generateRecoveryKey();
  const keyHash = await hashRecoveryKey(recoveryKey);
  const profile = await prisma.captchaProviderProfile.create({
    data: {
      name: input.name,
      type: input.type,
      encrypted_config: encryptConfig(parseProviderConfig(input.type, input.config)),
      recovery_key_salt: keyHash.salt,
      recovery_key_hash: keyHash.hash,
    },
  });
  await auditService.log({
    user_id: actorId,
    action: "captcha.provider_create",
    resource_type: "captcha_provider",
    resource_id: profile.id,
    new_value: { name: profile.name, type: profile.type },
  });
  return { profile: publicProfile(profile), recoveryKey };
}

export async function updateProfile(id: string, input: { name?: string; config?: ProviderConfig }, actorId: string) {
  const current = await prisma.captchaProviderProfile.findUnique({ where: { id } });
  if (!current) throw new AppError("Captcha provider not found", "NOT_FOUND", 404);
  const validatedConfig = input.config ? parseProviderConfig(current.type, input.config) : undefined;
  let keyData: Awaited<ReturnType<typeof hashRecoveryKey>> | undefined;
  let recoveryKey: string | undefined;
  if (input.config) {
    recoveryKey = generateRecoveryKey();
    keyData = await hashRecoveryKey(recoveryKey);
  }
  const profile = await prisma.captchaProviderProfile.update({
    where: { id },
    data: {
      name: input.name,
      encrypted_config: validatedConfig ? encryptConfig(validatedConfig) : undefined,
      recovery_key_salt: keyData?.salt,
      recovery_key_hash: keyData?.hash,
      config_version: input.config ? { increment: 1 } : undefined,
      health_status: input.config ? null : undefined,
      health_error_code: input.config ? null : undefined,
    },
  });
  if (current.is_active && input.config) await bumpPolicyVersion(actorId);
  await auditService.log({
    user_id: actorId,
    action: "captcha.provider_update",
    resource_type: "captcha_provider",
    resource_id: id,
    new_value: { name: profile.name, credentialsChanged: Boolean(input.config) },
  });
  return { profile: publicProfile(profile), recoveryKey };
}

export async function testProfile(id: string) {
  const profile = await prisma.captchaProviderProfile.findUnique({ where: { id } });
  if (!profile) throw new AppError("Captcha provider not found", "NOT_FOUND", 404);
  return checkHealth(profile);
}

export async function activateProfile(id: string, actorId: string) {
  const profile = await prisma.captchaProviderProfile.findUnique({ where: { id } });
  if (!profile) throw new AppError("Captcha provider not found", "NOT_FOUND", 404);
  const health = await checkHealth(profile);
  if (health.status !== "healthy") {
    throw new AppError("Captcha provider did not pass health check", "CAPTCHA_PROVIDER_UNAVAILABLE", 409);
  }
  await prisma.$transaction([
    prisma.captchaProviderProfile.updateMany({ data: { is_active: false } }),
    prisma.captchaProviderProfile.update({ where: { id }, data: { is_active: true } }),
    prisma.captchaPolicy.upsert({
      where: { id: "default" },
      update: { active_provider_id: id, config_version: { increment: 1 }, updated_by: actorId },
      create: { id: "default", active_provider_id: id, enabled: false, updated_by: actorId },
    }),
  ]);
  await auditService.log({
    user_id: actorId,
    action: "captcha.provider_activate",
    resource_type: "captcha_provider",
    resource_id: id,
  });
  return { activeProviderId: id, health };
}

export async function rotateRecoveryKey(id: string, actorId: string) {
  const recoveryKey = generateRecoveryKey();
  const keyHash = await hashRecoveryKey(recoveryKey);
  const result = await prisma.captchaProviderProfile.updateMany({
    where: { id },
    data: { recovery_key_salt: keyHash.salt, recovery_key_hash: keyHash.hash },
  });
  if (!result.count) throw new AppError("Captcha provider not found", "NOT_FOUND", 404);
  await auditService.log({
    user_id: actorId,
    action: "captcha.recovery_key_rotate",
    resource_type: "captcha_provider",
    resource_id: id,
  });
  return { recoveryKey };
}

async function bumpPolicyVersion(actorId: string) {
  await prisma.captchaPolicy.upsert({
    where: { id: "default" },
    update: { config_version: { increment: 1 }, updated_by: actorId },
    create: { id: "default", enabled: false, level: "medium", updated_by: actorId },
  });
}

export async function updatePolicy(input: { enabled?: boolean; level?: CaptchaPolicyLevel }, actorId: string) {
  const current = await getPolicy();
  if (input.enabled === true && !current.active_provider_id) {
    throw new AppError("Activate a captcha provider before enabling verification", "CAPTCHA_PROVIDER_REQUIRED", 409);
  }
  const changed =
    (input.enabled !== undefined && input.enabled !== current.enabled) ||
    (input.level !== undefined && input.level !== current.level);
  const policy = await prisma.captchaPolicy.update({
    where: { id: "default" },
    data: {
      enabled: input.enabled,
      level: input.level,
      config_version: changed ? { increment: 1 } : undefined,
      updated_by: actorId,
    },
  });
  if (changed) {
    await auditService.log({
      user_id: actorId,
      action: input.enabled === false ? "captcha.disable" : "captcha.policy_update",
      resource_type: "captcha_policy",
      resource_id: policy.id,
      old_value: { enabled: current.enabled, level: current.level },
      new_value: { enabled: policy.enabled, level: policy.level, configVersion: policy.config_version },
    });
  }
  return {
    enabled: policy.enabled,
    level: policy.level,
    activeProviderId: policy.active_provider_id,
    configVersion: policy.config_version,
  };
}
