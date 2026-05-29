-- Add project-level snapshots for template-derived workflow defaults.
ALTER TABLE "Project" ADD COLUMN "workflow_config" TEXT;
ALTER TABLE "Project" ADD COLUMN "upload_policy_config" TEXT;
ALTER TABLE "Project" ADD COLUMN "notification_policy" TEXT;
ALTER TABLE "Project" ADD COLUMN "ass_policy" TEXT;
ALTER TABLE "Project" ADD COLUMN "product_config" TEXT;
ALTER TABLE "Project" ADD COLUMN "release_task_type" TEXT;
