-- Add global and project-scoped temporary download link TTL configuration.
ALTER TABLE "Project" ADD COLUMN "download_link_ttl_seconds" INTEGER;
ALTER TABLE "DataRetentionSettings" ADD COLUMN "download_link_ttl_seconds" INTEGER NOT NULL DEFAULT 300;
