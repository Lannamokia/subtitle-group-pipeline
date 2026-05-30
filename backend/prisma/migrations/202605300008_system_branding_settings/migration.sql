CREATE TABLE "SystemBrandingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "app_name" TEXT NOT NULL DEFAULT 'SubtitleSync',
    "logo_storage_path" TEXT,
    "logo_backend_id" TEXT,
    "logo_mime_type" TEXT,
    "logo_size_bytes" INTEGER,
    "logo_updated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
