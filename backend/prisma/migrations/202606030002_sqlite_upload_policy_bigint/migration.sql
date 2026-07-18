CREATE TABLE "new_UploadPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT,
    "allowed_types" TEXT NOT NULL,
    "max_size_bytes" BIGINT NOT NULL DEFAULT 536870912000,
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "extension_whitelist" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

INSERT INTO "new_UploadPolicy" (
    "id",
    "project_id",
    "allowed_types",
    "max_size_bytes",
    "require_approval",
    "extension_whitelist",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "project_id",
    "allowed_types",
    "max_size_bytes",
    "require_approval",
    "extension_whitelist",
    "created_at",
    "updated_at"
FROM "UploadPolicy";

DROP TABLE "UploadPolicy";
ALTER TABLE "new_UploadPolicy" RENAME TO "UploadPolicy";
CREATE INDEX "UploadPolicy_project_id_idx" ON "UploadPolicy"("project_id");
