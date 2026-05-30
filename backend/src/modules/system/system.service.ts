import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { AppError } from "../../utils/response";
import * as storageService from "../storage/storage.service";
import type {
  QqBridgeSettingsInput,
  QqBridgeTestInput,
  SmtpSettingsInput,
  SmtpTestInput,
  UpdateBrandingInput,
} from "./system.schema";

const DEFAULT_APP_NAME = "SubtitleSync";
const LOGO_MAX_SIZE = 2 * 1024 * 1024;
const LOGO_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PASSWORD_MASK = "********";
const QQ_HEARTBEAT_TTL_SECONDS = Math.max(
  10,
  Number(process.env.QQ_BRIDGE_HEARTBEAT_TTL_SECONDS ?? 90)
);

export interface BrandingSettings {
  app_name: string;
  logo_url: string | null;
  logo_updated_at: Date | null;
}

interface BrandingRecord {
  id: string;
  app_name: string;
  logo_storage_path: string | null;
  logo_backend_id: string | null;
  logo_mime_type: string | null;
  logo_size_bytes: number | null;
  logo_updated_at: Date | null;
}

export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  passwordConfigured: boolean;
  from_address: string;
  from_name: string | null;
  reject_unauthorized: boolean;
  updated_at: Date | null;
}

export interface QqBridgeSettings {
  enabled: boolean;
  endpoint: string | null;
  secret_configured: boolean;
  last_heartbeat_at: Date | null;
  last_heartbeat_status: string | null;
  last_bot_id: string | null;
  last_bot_nickname: string | null;
  updated_at: Date | null;
}

interface SmtpSettingsRecord {
  id: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  from_address: string;
  from_name: string | null;
  reject_unauthorized: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface QqBridgeRuntimeSettings {
  id?: string;
  enabled: boolean;
  endpoint: string | null;
  secret: string | null;
  last_heartbeat_at?: Date | null;
  last_heartbeat_status?: string | null;
  last_heartbeat_error?: string | null;
  last_bot_id?: string | null;
  last_bot_nickname?: string | null;
  last_heartbeat_payload?: string | null;
  created_at?: Date;
  updated_at?: Date | null;
}

export interface QqBridgeHeartbeatInput {
  status?: string | null;
  connected?: boolean;
  bot_id?: string | number | null;
  bot_nickname?: string | null;
  error?: string | null;
  adapter?: string | null;
  version?: string | null;
}

export interface ChannelTestResult {
  success: boolean;
  message_id?: string;
}

export interface GlobalHealthStatus {
  checked_at: string;
  database: {
    connected: boolean;
    type: string;
    version: string | null;
    error: string | null;
  };
  qq_bridge: {
    configured: boolean;
    connected: boolean;
    endpoint: string | null;
    token_configured: boolean;
    last_heartbeat_at: string | null;
    heartbeat_status: string | null;
    heartbeat_age_seconds: number | null;
    bot_id: string | null;
    bot_nickname: string | null;
    error: string | null;
  };
}

function getDatabaseType(databaseUrl = env.DATABASE_URL): string {
  if (databaseUrl.startsWith("file:")) return "sqlite";
  if (databaseUrl.startsWith("mysql:")) return "mysql";
  if (databaseUrl.startsWith("postgresql:") || databaseUrl.startsWith("postgres:")) return "postgresql";
  return "unknown";
}

function defaultBrandingSettings(): BrandingSettings {
  return {
    app_name: DEFAULT_APP_NAME,
    logo_url: null,
    logo_updated_at: null,
  };
}

async function getDatabaseVersion(databaseType: string): Promise<string | null> {
  if (databaseType === "sqlite") {
    const rows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT sqlite_version() AS version`;
    return rows[0]?.version ?? null;
  }

  if (databaseType === "mysql") {
    const rows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
    return rows[0]?.version ?? null;
  }

  if (databaseType === "postgresql") {
    const rows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`;
    return rows[0]?.version ?? null;
  }

  await prisma.$queryRaw`SELECT 1`;
  return null;
}

async function getOrCreateBrandingRecord() {
  const existing = await prisma.systemBrandingSettings.findFirst({
    orderBy: { created_at: "asc" },
  });

  if (existing) return existing;

  return prisma.systemBrandingSettings.create({
    data: { app_name: DEFAULT_APP_NAME },
  });
}

function toBrandingSettings(record: BrandingRecord): BrandingSettings {
  const logoUpdatedAt = record.logo_updated_at ?? null;
  return {
    app_name: record.app_name || DEFAULT_APP_NAME,
    logo_url: record.logo_storage_path
      ? `/api/v1/system/logo${logoUpdatedAt ? `?v=${logoUpdatedAt.getTime()}` : ""}`
      : null,
    logo_updated_at: logoUpdatedAt,
  };
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  try {
    return toBrandingSettings(await getOrCreateBrandingRecord());
  } catch {
    return defaultBrandingSettings();
  }
}

export async function updateBrandingSettings(data: UpdateBrandingInput): Promise<BrandingSettings> {
  const current = await getOrCreateBrandingRecord();
  const updated = await prisma.systemBrandingSettings.update({
    where: { id: current.id },
    data: { app_name: data.app_name },
  });

  return toBrandingSettings(updated);
}

export async function uploadLogo(
  buffer: Buffer,
  contentType: string,
  originalFilename: string
): Promise<BrandingSettings> {
  if (!LOGO_ALLOWED_TYPES.includes(contentType)) {
    throw new AppError(
      `Invalid logo type. Allowed: ${LOGO_ALLOWED_TYPES.join(", ")}`,
      "VALIDATION_ERROR",
      400
    );
  }

  if (buffer.length > LOGO_MAX_SIZE) {
    throw new AppError("Logo too large. Max size: 2MB", "VALIDATION_ERROR", 400);
  }

  const current = await getOrCreateBrandingRecord();
  const backend = await storageService.getDefaultBackend();

  if (current.logo_backend_id && current.logo_storage_path) {
    await storageService.deleteFile(
      current.logo_backend_id,
      current.logo_storage_path,
      current.logo_size_bytes ?? 0
    ).catch(() => undefined);
  }

  const uploaded = await storageService.uploadFile(
    backend.id,
    "system-branding",
    buffer,
    originalFilename,
    contentType
  );

  const logoUpdatedAt = new Date();
  const updated = await prisma.systemBrandingSettings.update({
    where: { id: current.id },
    data: {
      logo_backend_id: backend.id,
      logo_storage_path: uploaded.storagePath,
      logo_mime_type: contentType,
      logo_size_bytes: uploaded.size,
      logo_updated_at: logoUpdatedAt,
    },
  });

  return toBrandingSettings(updated);
}

export async function getLogoFile(): Promise<{ buffer: Buffer; contentType: string }> {
  const settings = await getOrCreateBrandingRecord();

  if (!settings.logo_backend_id || !settings.logo_storage_path) {
    throw new AppError("Logo not configured", "NOT_FOUND", 404);
  }

  const buffer = await storageService.downloadStoredFile(
    settings.logo_backend_id,
    settings.logo_storage_path
  );

  return {
    buffer,
    contentType: settings.logo_mime_type || "image/png",
  };
}

function serializeSmtpSettings(record: SmtpSettingsRecord | null): SmtpSettings {
  return {
    enabled: record?.enabled ?? false,
    host: record?.host ?? "",
    port: record?.port ?? 587,
    secure: record?.secure ?? false,
    username: record?.username ?? null,
    passwordConfigured: Boolean(record?.password),
    from_address: record?.from_address ?? "",
    from_name: record?.from_name ?? null,
    reject_unauthorized: record?.reject_unauthorized ?? true,
    updated_at: record?.updated_at ?? null,
  };
}

function serializeQqBridgeSettings(record: QqBridgeRuntimeSettings | null): QqBridgeSettings {
  const envEndpoint = env.NONEBOT_HTTP_API ?? null;
  const envSecret = env.QQ_BRIDGE_TOKEN ?? null;
  const endpoint = record?.endpoint ?? envEndpoint;
  const secret = record?.secret ?? envSecret;

  return {
    enabled: record?.enabled ?? Boolean(envEndpoint),
    endpoint,
    secret_configured: Boolean(secret),
    last_heartbeat_at: record?.last_heartbeat_at ?? null,
    last_heartbeat_status: record?.last_heartbeat_status ?? null,
    last_bot_id: record?.last_bot_id ?? null,
    last_bot_nickname: record?.last_bot_nickname ?? null,
    updated_at: record?.updated_at ?? null,
  };
}

async function getSmtpSettingsRecord(): Promise<SmtpSettingsRecord | null> {
  const record = await prisma.smtpSettings.findFirst({
    orderBy: { created_at: "asc" },
  });
  if (!record) return null;

  return {
    ...record,
    enabled: Boolean(record.enabled),
    secure: Boolean(record.secure),
    reject_unauthorized: Boolean(record.reject_unauthorized),
  };
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  return serializeSmtpSettings(await getSmtpSettingsRecord());
}

export async function getSmtpRuntimeSettings(): Promise<SmtpSettingsRecord | null> {
  return getSmtpSettingsRecord();
}

export async function updateSmtpSettings(data: SmtpSettingsInput): Promise<SmtpSettings> {
  const existing = await getSmtpSettingsRecord();
  const password = data.password === PASSWORD_MASK ? existing?.password ?? null : data.password ?? existing?.password ?? null;
  const enabled = data.enabled ?? false;
  const secure = data.secure ?? data.port === 465;
  const rejectUnauthorized = data.reject_unauthorized ?? true;
  const host = data.host?.trim() ?? "";
  const username = data.username?.trim() || null;
  const fromAddress = data.from_address?.trim() ?? "";
  const fromName = data.from_name?.trim() || null;

  if (enabled && !host) {
    throw new AppError("SMTP host is required when email sending is enabled", "VALIDATION_ERROR", 400);
  }
  if (enabled && !password) {
    throw new AppError("SMTP password is required when email sending is enabled", "VALIDATION_ERROR", 400);
  }
  if (enabled && !fromAddress) {
    throw new AppError("SMTP sender address is required when email sending is enabled", "VALIDATION_ERROR", 400);
  }

  if (existing) {
    await prisma.smtpSettings.update({
      where: { id: existing.id },
      data: {
        enabled,
        host,
        port: data.port,
        secure,
        username,
        password,
        from_address: fromAddress,
        from_name: fromName,
        reject_unauthorized: rejectUnauthorized,
      },
    });
  } else {
    await prisma.smtpSettings.create({
      data: {
        enabled,
        host,
        port: data.port,
        secure,
        username,
        password,
        from_address: fromAddress,
        from_name: fromName,
        reject_unauthorized: rejectUnauthorized,
      },
    });
  }

  return getSmtpSettings();
}

export async function testSmtpSettings(data: SmtpTestInput): Promise<ChannelTestResult> {
  const settings = await getSmtpSettingsRecord();
  const hasEnvSmtp = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );

  if (!settings?.enabled && !hasEnvSmtp) {
    throw new AppError("SMTP service is not enabled or configured", "VALIDATION_ERROR", 400);
  }

  const { sendEmail } = await import("../notification/adapters/email.adapter");
  const result = await sendEmail({
    to: data.to,
    subject: "通知渠道测试邮件",
    body: `这是一封来自字幕组协作平台的测试邮件。\n发送时间：${new Date().toISOString()}`,
    notificationType: "system",
  });

  if (!result.success) {
    throw new AppError(result.error || "Failed to send test email", "DELIVERY_FAILED", 502);
  }

  return {
    success: true,
    message_id: result.messageId,
  };
}

async function getQqBridgeSettingsRecord(): Promise<QqBridgeRuntimeSettings | null> {
  const record = await prisma.qqBridgeSettings.findFirst({
    orderBy: { created_at: "asc" },
  });
  if (!record) return null;

  return {
    ...record,
    enabled: Boolean(record.enabled),
    endpoint: record.endpoint || null,
    secret: record.secret || null,
    last_heartbeat_at: normalizeDate(record.last_heartbeat_at),
    last_heartbeat_status: record.last_heartbeat_status || null,
    last_heartbeat_error: record.last_heartbeat_error || null,
    last_bot_id: record.last_bot_id || null,
    last_bot_nickname: record.last_bot_nickname || null,
    last_heartbeat_payload: record.last_heartbeat_payload || null,
    updated_at: record.updated_at ?? null,
  };
}

export async function getQqBridgeSettings(): Promise<QqBridgeSettings> {
  return serializeQqBridgeSettings(await getQqBridgeSettingsRecord().catch(() => null));
}

export async function getQqBridgeRuntimeSettings(): Promise<QqBridgeRuntimeSettings> {
  const record = await getQqBridgeSettingsRecord().catch(() => null);
  return {
    enabled: record?.enabled ?? Boolean(env.NONEBOT_HTTP_API),
    endpoint: record?.endpoint ?? env.NONEBOT_HTTP_API ?? null,
    secret: record?.secret ?? env.QQ_BRIDGE_TOKEN ?? null,
    last_heartbeat_at: record?.last_heartbeat_at ?? null,
    last_heartbeat_status: record?.last_heartbeat_status ?? null,
    last_heartbeat_error: record?.last_heartbeat_error ?? null,
    last_bot_id: record?.last_bot_id ?? null,
    last_bot_nickname: record?.last_bot_nickname ?? null,
    last_heartbeat_payload: record?.last_heartbeat_payload ?? null,
    updated_at: record?.updated_at ?? null,
  };
}

export async function updateQqBridgeSettings(data: QqBridgeSettingsInput): Promise<QqBridgeSettings> {
  const existing = await getQqBridgeSettingsRecord().catch(() => null);
  const enabled = data.enabled ?? false;
  const endpoint = data.endpoint?.trim() || null;
  const fallbackSecret = existing?.secret ?? env.QQ_BRIDGE_TOKEN ?? null;
  const secret = data.secret === PASSWORD_MASK ? fallbackSecret : data.secret?.trim() || fallbackSecret;

  if (enabled && !endpoint) {
    throw new AppError("NoneBot endpoint is required when QQ bridge is enabled", "VALIDATION_ERROR", 400);
  }
  if (enabled && !secret) {
    throw new AppError("QQ bridge secret is required when QQ bridge is enabled", "VALIDATION_ERROR", 400);
  }

  if (existing) {
    await prisma.qqBridgeSettings.update({
      where: { id: existing.id },
      data: {
        enabled,
        endpoint,
        secret,
      },
    });
  } else {
    await prisma.qqBridgeSettings.create({
      data: {
        enabled,
        endpoint,
        secret,
      },
    });
  }

  return getQqBridgeSettings();
}

export async function testQqBridgeSettings(data: QqBridgeTestInput): Promise<ChannelTestResult> {
  const groupId = (data.group_id ?? data.groupId ?? "").trim();
  const atUserQQ = (data.at_user_qq ?? data.atUserQQ ?? "").trim();
  const settings = await getQqBridgeRuntimeSettings();

  if (!settings.enabled || !settings.endpoint) {
    throw new AppError("QQ bridge is not enabled or configured", "VALIDATION_ERROR", 400);
  }

  const { sendGroupMessage } = await import("../notification/adapters/qq.adapter");
  const result = await sendGroupMessage({
    groupId,
    atUsers: [atUserQQ],
    content: `通知渠道测试消息\n发送时间：${new Date().toISOString()}`,
  });

  if (!result.success) {
    throw new AppError(result.error || "Failed to send QQ test message", "DELIVERY_FAILED", 502);
  }

  return {
    success: true,
    message_id: result.messageId,
  };
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeHeartbeatStatus(data: QqBridgeHeartbeatInput): string {
  const explicit = data.status?.trim();
  if (data.connected === false) {
    return explicit && explicit !== "online" ? explicit.slice(0, 50) : "waiting_for_bot";
  }
  if (explicit) return explicit.slice(0, 50);
  return "online";
}

function truncateNullable(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function getHeartbeatAgeSeconds(heartbeatAt: Date | null): number | null {
  if (!heartbeatAt) return null;
  return Math.max(0, Math.floor((Date.now() - heartbeatAt.getTime()) / 1000));
}

function getQQHeartbeatError(
  settings: QqBridgeRuntimeSettings,
  heartbeatAt: Date | null,
  heartbeatAgeSeconds: number | null
): string | null {
  if (!heartbeatAt) return "尚未收到 QQ 桥接器心跳";
  if (heartbeatAgeSeconds !== null && heartbeatAgeSeconds > QQ_HEARTBEAT_TTL_SECONDS) {
    return "QQ 桥接器心跳已超时";
  }
  if (settings.last_heartbeat_error) return settings.last_heartbeat_error;
  if (settings.last_heartbeat_status && settings.last_heartbeat_status !== "online") {
    return `QQ 桥接器状态：${settings.last_heartbeat_status}`;
  }
  return null;
}

export async function recordQqBridgeHeartbeat(data: QqBridgeHeartbeatInput): Promise<QqBridgeSettings> {
  const existing = await getQqBridgeSettingsRecord().catch(() => null);
  const now = new Date();
  const status = normalizeHeartbeatStatus(data);
  const error = truncateNullable(data.error, 1000);
  const botId = truncateNullable(data.bot_id, 120);
  const botNickname = truncateNullable(data.bot_nickname, 120);
  const payload = JSON.stringify({
    connected: data.connected ?? status === "online",
    adapter: data.adapter ?? null,
    version: data.version ?? null,
  });

  if (existing) {
    await prisma.qqBridgeSettings.update({
      where: { id: existing.id },
      data: {
        last_heartbeat_at: now,
        last_heartbeat_status: status,
        last_heartbeat_error: error,
        last_bot_id: botId,
        last_bot_nickname: botNickname,
        last_heartbeat_payload: payload,
      },
    });
  } else {
    await prisma.qqBridgeSettings.create({
      data: {
        enabled: Boolean(env.NONEBOT_HTTP_API),
        endpoint: env.NONEBOT_HTTP_API ?? null,
        secret: env.QQ_BRIDGE_TOKEN ?? null,
        last_heartbeat_at: now,
        last_heartbeat_status: status,
        last_heartbeat_error: error,
        last_bot_id: botId,
        last_bot_nickname: botNickname,
        last_heartbeat_payload: payload,
      },
    });
  }

  return getQqBridgeSettings();
}

export async function getGlobalHealthStatus(): Promise<GlobalHealthStatus> {
  const databaseType = getDatabaseType();
  const database = {
    connected: false,
    type: databaseType,
    version: null as string | null,
    error: null as string | null,
  };

  try {
    await prisma.$connect();
    database.version = await getDatabaseVersion(databaseType);
    database.connected = true;
  } catch (error) {
    database.error = error instanceof Error ? error.message : String(error);
  }

  const qqSettings = await getQqBridgeRuntimeSettings();
  const qqConfigured = Boolean(qqSettings.enabled && qqSettings.endpoint);
  const heartbeatAt = normalizeDate(qqSettings.last_heartbeat_at);
  const heartbeatAgeSeconds = getHeartbeatAgeSeconds(heartbeatAt);
  const qqError = qqConfigured
    ? getQQHeartbeatError(qqSettings, heartbeatAt, heartbeatAgeSeconds)
    : null;

  return {
    checked_at: new Date().toISOString(),
    database,
    qq_bridge: {
      configured: qqConfigured,
      connected: qqConfigured && !qqError,
      endpoint: qqConfigured ? qqSettings.endpoint : null,
      token_configured: Boolean(qqSettings.secret),
      last_heartbeat_at: heartbeatAt?.toISOString() ?? null,
      heartbeat_status: qqSettings.last_heartbeat_status ?? null,
      heartbeat_age_seconds: heartbeatAgeSeconds,
      bot_id: qqSettings.last_bot_id ?? null,
      bot_nickname: qqSettings.last_bot_nickname ?? null,
      error: qqError,
    },
  };
}
