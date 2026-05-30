import { prisma } from "../../config/database";
import { env } from "../../config/env";
import crypto from "crypto";
import { AppError } from "../../utils/response";
import * as storageService from "../storage/storage.service";
import type { QqBridgeSettingsInput, SmtpSettingsInput, UpdateBrandingInput } from "./system.schema";

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
  const existing = await prisma.$queryRaw<BrandingRecord[]>`
    SELECT id, app_name, logo_storage_path, logo_backend_id, logo_mime_type, logo_size_bytes, logo_updated_at
    FROM SystemBrandingSettings
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (existing[0]) return existing[0];

  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO SystemBrandingSettings (id, app_name, created_at, updated_at)
    VALUES (${id}, ${DEFAULT_APP_NAME}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;

  return {
    id,
    app_name: DEFAULT_APP_NAME,
    logo_storage_path: null,
    logo_backend_id: null,
    logo_mime_type: null,
    logo_size_bytes: null,
    logo_updated_at: null,
  };
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
  return toBrandingSettings(await getOrCreateBrandingRecord());
}

export async function updateBrandingSettings(data: UpdateBrandingInput): Promise<BrandingSettings> {
  const current = await getOrCreateBrandingRecord();
  await prisma.$executeRaw`
    UPDATE SystemBrandingSettings
    SET app_name = ${data.app_name}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${current.id}
  `;

  return toBrandingSettings({
    ...current,
    app_name: data.app_name,
  });
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
  await prisma.$executeRaw`
    UPDATE SystemBrandingSettings
    SET logo_backend_id = ${backend.id},
        logo_storage_path = ${uploaded.storagePath},
        logo_mime_type = ${contentType},
        logo_size_bytes = ${uploaded.size},
        logo_updated_at = ${logoUpdatedAt},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${current.id}
  `;

  return toBrandingSettings({
    ...current,
    logo_backend_id: backend.id,
    logo_storage_path: uploaded.storagePath,
    logo_mime_type: contentType,
    logo_size_bytes: uploaded.size,
    logo_updated_at: logoUpdatedAt,
  });
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
  const records = await prisma.$queryRaw<SmtpSettingsRecord[]>`
    SELECT id, enabled, host, port, secure, username, password, from_address, from_name, reject_unauthorized, created_at, updated_at
    FROM SmtpSettings
    ORDER BY created_at ASC
    LIMIT 1
  `;

  const record = records[0];
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
    await prisma.$executeRaw`
      UPDATE SmtpSettings
      SET enabled = ${enabled},
          host = ${host},
          port = ${data.port},
          secure = ${secure},
          username = ${username},
          password = ${password},
          from_address = ${fromAddress},
          from_name = ${fromName},
          reject_unauthorized = ${rejectUnauthorized},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existing.id}
    `;
  } else {
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO SmtpSettings (id, enabled, host, port, secure, username, password, from_address, from_name, reject_unauthorized, created_at, updated_at)
      VALUES (${id}, ${enabled}, ${host}, ${data.port}, ${secure}, ${username}, ${password}, ${fromAddress}, ${fromName}, ${rejectUnauthorized}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
  }

  return getSmtpSettings();
}

async function getQqBridgeSettingsRecord(): Promise<QqBridgeRuntimeSettings | null> {
  const records = await prisma.$queryRaw<QqBridgeRuntimeSettings[]>`
    SELECT id, enabled, endpoint, secret, last_heartbeat_at, last_heartbeat_status, last_heartbeat_error, last_bot_id, last_bot_nickname, last_heartbeat_payload, created_at, updated_at
    FROM QqBridgeSettings
    ORDER BY created_at ASC
    LIMIT 1
  `;

  const record = records[0];
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
    await prisma.$executeRaw`
      UPDATE QqBridgeSettings
      SET enabled = ${enabled},
          endpoint = ${endpoint},
          secret = ${secret},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existing.id}
    `;
  } else {
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO QqBridgeSettings (id, enabled, endpoint, secret, created_at, updated_at)
      VALUES (${id}, ${enabled}, ${endpoint}, ${secret}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
  }

  return getQqBridgeSettings();
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
    await prisma.$executeRaw`
      UPDATE QqBridgeSettings
      SET last_heartbeat_at = ${now},
          last_heartbeat_status = ${status},
          last_heartbeat_error = ${error},
          last_bot_id = ${botId},
          last_bot_nickname = ${botNickname},
          last_heartbeat_payload = ${payload},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existing.id}
    `;
  } else {
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO QqBridgeSettings (id, enabled, endpoint, secret, last_heartbeat_at, last_heartbeat_status, last_heartbeat_error, last_bot_id, last_bot_nickname, last_heartbeat_payload, created_at, updated_at)
      VALUES (${id}, ${Boolean(env.NONEBOT_HTTP_API)}, ${env.NONEBOT_HTTP_API ?? null}, ${env.QQ_BRIDGE_TOKEN ?? null}, ${now}, ${status}, ${error}, ${botId}, ${botNickname}, ${payload}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
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
