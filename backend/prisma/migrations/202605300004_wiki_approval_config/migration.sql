-- Add global and project-level wiki approval configuration.
ALTER TABLE "Project" ADD COLUMN "wiki_approval_required" BOOLEAN;
ALTER TABLE "DataRetentionSettings" ADD COLUMN "wiki_approval_required" BOOLEAN NOT NULL DEFAULT false;
