import { prisma } from "../../config/database";
import crypto from "crypto";
import { AppError } from "../../utils/response";
import * as storageService from "../storage/storage.service";
import type { UpdateBrandingInput } from "./system.schema";

const DEFAULT_APP_NAME = "SubtitleSync";
const LOGO_MAX_SIZE = 2 * 1024 * 1024;
const LOGO_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

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
