import { prisma } from "../../config/database";
import { env } from "../../config/env";
import crypto from "crypto";
import { AppError } from "../../utils/response";
import * as storageService from "../storage/storage.service";
import { checkQQBridgeHealth, getQQBridgeEndpoint } from "../notification/adapters/qq.adapter";
import type { QqBridgeSettingsInput, SmtpSettingsInput, UpdateBrandingInput } from "./system.schema";

const DEFAULT_APP_NAME = "SubtitleSync";
const LOGO_MAX_SIZE = 2 * 1024 * 1024;
const LOGO_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PASSWORD_MASK = "********";

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
  created_at?: Date;
  updated_at?: Date | null;
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
    SELECT id, enabled, endpoint, secret, created_at, updated_at
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
  const qqHealth = qqConfigured
    ? await checkQQBridgeHealth()
    : { success: false, error: "QQ bridge is not configured" };

  return {
    checked_at: new Date().toISOString(),
    database,
    qq_bridge: {
      configured: qqConfigured,
      connected: qqConfigured ? qqHealth.success : false,
      endpoint: qqConfigured ? await getQQBridgeEndpoint() : null,
      token_configured: Boolean(qqSettings.secret),
      error: qqConfigured ? qqHealth.error ?? null : null,
    },
  };
}
