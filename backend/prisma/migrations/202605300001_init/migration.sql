-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "nickname" TEXT,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "avatar_url" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "qq_number" TEXT,
    "bio" TEXT,
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "RegistrationPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'open',
    "require_qq" BOOLEAN NOT NULL DEFAULT false,
    "qq_group_number" TEXT,
    "welcome_message" TEXT,
    "auto_approve" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "updated_by" TEXT
);

-- CreateTable
CREATE TABLE "VerificationChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "qq_number" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "used_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RoleTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TagApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "reason" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TagApplication_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TagApplication_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "RoleTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "project_type" TEXT NOT NULL DEFAULT 'anime',
    "roles" TEXT NOT NULL,
    "upload_policy" TEXT NOT NULL,
    "notification_policy" TEXT NOT NULL,
    "ass_policy" TEXT NOT NULL,
    "product_config" TEXT NOT NULL,
    "delivery_checklist" TEXT NOT NULL,
    "release_task_type" TEXT NOT NULL DEFAULT 'torrent',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "project_type" TEXT NOT NULL DEFAULT 'anime',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "owner_id" TEXT NOT NULL,
    "template_id" TEXT,
    "storage_backend_id" TEXT,
    "current_season" INTEGER NOT NULL DEFAULT 1,
    "delivery_checklist" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" DATETIME,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "ProjectTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_storage_backend_id_fkey" FOREIGN KEY ("storage_backend_id") REFERENCES "StorageBackend" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "season_number" INTEGER NOT NULL DEFAULT 1,
    "unit_number" INTEGER NOT NULL,
    "title" TEXT,
    "episode_length" INTEGER,
    "air_date" DATETIME,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "ProjectUnit_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'translation',
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" DATETIME,
    CONSTRAINT "ProjectMember_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "message" TEXT,
    "approved" BOOLEAN,
    "approved_by" TEXT,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JoinRequest_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JoinRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_publish',
    "assignee_id" TEXT,
    "creator_id" TEXT NOT NULL,
    "blocked_by" TEXT,
    "due_date" DATETIME,
    "started_at" DATETIME,
    "submitted_at" DATETIME,
    "completed_at" DATETIME,
    "cancelled_at" DATETIME,
    "frozen_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ProjectUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "depends_on_id" TEXT NOT NULL,
    "dependency_type" TEXT NOT NULL DEFAULT 'finish_to_start',
    CONSTRAINT "TaskDependency_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TranslationClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "user_id" TEXT NOT NULL,
    "segment_start" INTEGER NOT NULL,
    "segment_end" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" DATETIME,
    "approved_at" DATETIME,
    "expires_at" DATETIME,
    CONSTRAINT "TranslationClaim_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TranslationClaim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TranslationClaim_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ProjectUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TranslationSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "claim_id" TEXT,
    "file_version_id" TEXT,
    "content" TEXT NOT NULL,
    "line_count" INTEGER,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TranslationSubmission_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TranslationSubmission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TranslationSubmission_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "TranslationClaim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MergeJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input_files" TEXT NOT NULL,
    "output_file_id" TEXT,
    "log" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SubtitleConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "conflict_type" TEXT NOT NULL,
    "description" TEXT,
    "affected_lines" TEXT,
    "file_a_id" TEXT NOT NULL,
    "file_b_id" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'unresolved',
    "resolved_by" TEXT,
    "resolved_at" DATETIME,
    "resolution_note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "file_version_id" TEXT,
    "reviewer_id" TEXT NOT NULL,
    "requester_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "comments" TEXT,
    "line_comments" TEXT,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "Review_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Review_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Review_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "review_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewSnapshot_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "Review" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileEntity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "storage_backend_id" TEXT,
    "checksum" TEXT,
    "metadata" TEXT,
    "tags" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" DATETIME,
    "deleted_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileEntity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileEntity_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "change_summary" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "is_latest_approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileVersion_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "FileEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LinkHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "file_id" TEXT,
    "url" TEXT NOT NULL,
    "link_type" TEXT NOT NULL,
    "description" TEXT,
    "expires_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkHistory_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LinkHistory_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "FileEntity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UploadPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT,
    "allowed_types" TEXT NOT NULL,
    "max_size_bytes" INTEGER NOT NULL DEFAULT 536870912000,
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "extension_whitelist" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "project_id" TEXT,
    "task_id" TEXT,
    "actor_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "channels" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" DATETIME,
    CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notification_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "external_id" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" DATETIME,
    "delivered_at" DATETIME,
    "failed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "qq_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_site_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_escalation_min" INTEGER NOT NULL DEFAULT 30,
    "qq_escalation_min" INTEGER NOT NULL DEFAULT 120,
    "task_assigned" BOOLEAN NOT NULL DEFAULT true,
    "task_completed" BOOLEAN NOT NULL DEFAULT true,
    "task_reassigned" BOOLEAN NOT NULL DEFAULT true,
    "review_requested" BOOLEAN NOT NULL DEFAULT true,
    "review_approved" BOOLEAN NOT NULL DEFAULT true,
    "review_rejected" BOOLEAN NOT NULL DEFAULT true,
    "join_approved" BOOLEAN NOT NULL DEFAULT true,
    "file_uploaded" BOOLEAN NOT NULL DEFAULT true,
    "mention" BOOLEAN NOT NULL DEFAULT true,
    "task_overdue" BOOLEAN NOT NULL DEFAULT true,
    "conflict_detected" BOOLEAN NOT NULL DEFAULT true,
    "downstream_reset" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'global',
    "project_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Announcement_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Announcement_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WikiDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pending_content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "WikiDocument_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WikiDocument_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "file_version_id" TEXT,
    "wiki_id" TEXT,
    "task_id" TEXT,
    "line_number" INTEGER,
    "parent_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "Comment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "FileEntity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Comment_wiki_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "WikiDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Comment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "actor_id" TEXT,
    "metadata" TEXT,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimelineEvent_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimelineEvent_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "file_id" TEXT,
    "created_by" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "max_downloads" INTEGER,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DownloadLink_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DownloadLink_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StorageBackend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "backend_type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "quota_bytes" BIGINT,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "last_health_check" DATETIME,
    "health_status" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "project_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataRetentionSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auto_archive_days" INTEGER NOT NULL DEFAULT 90,
    "auto_delete_days" INTEGER DEFAULT 365,
    "recycle_bin_days" INTEGER NOT NULL DEFAULT 30,
    "audit_log_retention_days" INTEGER NOT NULL DEFAULT 365,
    "notification_retention_days" INTEGER NOT NULL DEFAULT 30,
    "max_file_versions" INTEGER NOT NULL DEFAULT 10,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RecycleBinRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "resource_data" TEXT NOT NULL,
    "deleted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "restored_at" DATETIME,
    "restored_by" TEXT,
    CONSTRAINT "RecycleBinRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_created_at_idx" ON "User"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationChallenge_code_key" ON "VerificationChallenge"("code");

-- CreateIndex
CREATE INDEX "VerificationChallenge_code_idx" ON "VerificationChallenge"("code");

-- CreateIndex
CREATE INDEX "VerificationChallenge_qq_number_idx" ON "VerificationChallenge"("qq_number");

-- CreateIndex
CREATE INDEX "VerificationChallenge_expires_at_idx" ON "VerificationChallenge"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "RoleTag_name_key" ON "RoleTag"("name");

-- CreateIndex
CREATE INDEX "TagApplication_user_id_idx" ON "TagApplication"("user_id");

-- CreateIndex
CREATE INDEX "TagApplication_tag_id_idx" ON "TagApplication"("tag_id");

-- CreateIndex
CREATE INDEX "TagApplication_approved_idx" ON "TagApplication"("approved");

-- CreateIndex
CREATE UNIQUE INDEX "TagApplication_user_id_tag_id_key" ON "TagApplication"("user_id", "tag_id");

-- CreateIndex
CREATE INDEX "ProjectTemplate_is_default_idx" ON "ProjectTemplate"("is_default");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_owner_id_idx" ON "Project"("owner_id");

-- CreateIndex
CREATE INDEX "Project_project_type_idx" ON "Project"("project_type");

-- CreateIndex
CREATE INDEX "Project_is_archived_idx" ON "Project"("is_archived");

-- CreateIndex
CREATE INDEX "Project_deleted_at_idx" ON "Project"("deleted_at");

-- CreateIndex
CREATE INDEX "Project_created_at_idx" ON "Project"("created_at");

-- CreateIndex
CREATE INDEX "ProjectUnit_project_id_idx" ON "ProjectUnit"("project_id");

-- CreateIndex
CREATE INDEX "ProjectUnit_season_number_idx" ON "ProjectUnit"("season_number");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUnit_project_id_season_number_unit_number_key" ON "ProjectUnit"("project_id", "season_number", "unit_number");

-- CreateIndex
CREATE INDEX "ProjectMember_project_id_idx" ON "ProjectMember"("project_id");

-- CreateIndex
CREATE INDEX "ProjectMember_user_id_idx" ON "ProjectMember"("user_id");

-- CreateIndex
CREATE INDEX "ProjectMember_role_idx" ON "ProjectMember"("role");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_project_id_user_id_key" ON "ProjectMember"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "JoinRequest_project_id_idx" ON "JoinRequest"("project_id");

-- CreateIndex
CREATE INDEX "JoinRequest_user_id_idx" ON "JoinRequest"("user_id");

-- CreateIndex
CREATE INDEX "JoinRequest_approved_idx" ON "JoinRequest"("approved");

-- CreateIndex
CREATE INDEX "Task_project_id_idx" ON "Task"("project_id");

-- CreateIndex
CREATE INDEX "Task_unit_id_idx" ON "Task"("unit_id");

-- CreateIndex
CREATE INDEX "Task_assignee_id_idx" ON "Task"("assignee_id");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_role_idx" ON "Task"("role");

-- CreateIndex
CREATE INDEX "Task_due_date_idx" ON "Task"("due_date");

-- CreateIndex
CREATE INDEX "TaskDependency_task_id_idx" ON "TaskDependency"("task_id");

-- CreateIndex
CREATE INDEX "TaskDependency_depends_on_id_idx" ON "TaskDependency"("depends_on_id");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_task_id_depends_on_id_key" ON "TaskDependency"("task_id", "depends_on_id");

-- CreateIndex
CREATE INDEX "TranslationClaim_task_id_idx" ON "TranslationClaim"("task_id");

-- CreateIndex
CREATE INDEX "TranslationClaim_unit_id_idx" ON "TranslationClaim"("unit_id");

-- CreateIndex
CREATE INDEX "TranslationClaim_user_id_idx" ON "TranslationClaim"("user_id");

-- CreateIndex
CREATE INDEX "TranslationClaim_status_idx" ON "TranslationClaim"("status");

-- CreateIndex
CREATE INDEX "TranslationClaim_expires_at_idx" ON "TranslationClaim"("expires_at");

-- CreateIndex
CREATE INDEX "TranslationSubmission_task_id_idx" ON "TranslationSubmission"("task_id");

-- CreateIndex
CREATE INDEX "TranslationSubmission_user_id_idx" ON "TranslationSubmission"("user_id");

-- CreateIndex
CREATE INDEX "TranslationSubmission_claim_id_idx" ON "TranslationSubmission"("claim_id");

-- CreateIndex
CREATE INDEX "TranslationSubmission_file_version_id_idx" ON "TranslationSubmission"("file_version_id");

-- CreateIndex
CREATE INDEX "MergeJob_project_id_idx" ON "MergeJob"("project_id");

-- CreateIndex
CREATE INDEX "MergeJob_status_idx" ON "MergeJob"("status");

-- CreateIndex
CREATE INDEX "MergeJob_created_at_idx" ON "MergeJob"("created_at");

-- CreateIndex
CREATE INDEX "SubtitleConflict_project_id_idx" ON "SubtitleConflict"("project_id");

-- CreateIndex
CREATE INDEX "SubtitleConflict_conflict_type_idx" ON "SubtitleConflict"("conflict_type");

-- CreateIndex
CREATE INDEX "SubtitleConflict_resolution_idx" ON "SubtitleConflict"("resolution");

-- CreateIndex
CREATE INDEX "SubtitleConflict_created_at_idx" ON "SubtitleConflict"("created_at");

-- CreateIndex
CREATE INDEX "Review_project_id_idx" ON "Review"("project_id");

-- CreateIndex
CREATE INDEX "Review_task_id_idx" ON "Review"("task_id");

-- CreateIndex
CREATE INDEX "Review_reviewer_id_idx" ON "Review"("reviewer_id");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- CreateIndex
CREATE INDEX "Review_submitted_at_idx" ON "Review"("submitted_at");

-- CreateIndex
CREATE INDEX "ReviewSnapshot_review_id_idx" ON "ReviewSnapshot"("review_id");

-- CreateIndex
CREATE INDEX "ReviewSnapshot_file_id_idx" ON "ReviewSnapshot"("file_id");

-- CreateIndex
CREATE INDEX "FileEntity_project_id_idx" ON "FileEntity"("project_id");

-- CreateIndex
CREATE INDEX "FileEntity_uploader_id_idx" ON "FileEntity"("uploader_id");

-- CreateIndex
CREATE INDEX "FileEntity_file_type_idx" ON "FileEntity"("file_type");

-- CreateIndex
CREATE INDEX "FileEntity_is_deleted_idx" ON "FileEntity"("is_deleted");

-- CreateIndex
CREATE INDEX "FileEntity_created_at_idx" ON "FileEntity"("created_at");

-- CreateIndex
CREATE INDEX "FileVersion_file_id_idx" ON "FileVersion"("file_id");

-- CreateIndex
CREATE INDEX "FileVersion_is_current_idx" ON "FileVersion"("is_current");

-- CreateIndex
CREATE INDEX "FileVersion_is_latest_approved_idx" ON "FileVersion"("is_latest_approved");

-- CreateIndex
CREATE INDEX "FileVersion_created_at_idx" ON "FileVersion"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_file_id_version_number_key" ON "FileVersion"("file_id", "version_number");

-- CreateIndex
CREATE INDEX "LinkHistory_project_id_idx" ON "LinkHistory"("project_id");

-- CreateIndex
CREATE INDEX "LinkHistory_file_id_idx" ON "LinkHistory"("file_id");

-- CreateIndex
CREATE INDEX "LinkHistory_link_type_idx" ON "LinkHistory"("link_type");

-- CreateIndex
CREATE INDEX "UploadPolicy_project_id_idx" ON "UploadPolicy"("project_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_idx" ON "Notification"("user_id");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_project_id_idx" ON "Notification"("project_id");

-- CreateIndex
CREATE INDEX "Notification_created_at_idx" ON "Notification"("created_at");

-- CreateIndex
CREATE INDEX "NotificationDelivery_notification_id_idx" ON "NotificationDelivery"("notification_id");

-- CreateIndex
CREATE INDEX "NotificationDelivery_channel_idx" ON "NotificationDelivery"("channel");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_user_id_key" ON "NotificationPreference"("user_id");

-- CreateIndex
CREATE INDEX "NotificationPreference_user_id_idx" ON "NotificationPreference"("user_id");

-- CreateIndex
CREATE INDEX "Announcement_type_idx" ON "Announcement"("type");

-- CreateIndex
CREATE INDEX "Announcement_project_id_idx" ON "Announcement"("project_id");

-- CreateIndex
CREATE INDEX "Announcement_is_active_idx" ON "Announcement"("is_active");

-- CreateIndex
CREATE INDEX "Announcement_is_pinned_idx" ON "Announcement"("is_pinned");

-- CreateIndex
CREATE INDEX "Announcement_created_at_idx" ON "Announcement"("created_at");

-- CreateIndex
CREATE INDEX "WikiDocument_project_id_idx" ON "WikiDocument"("project_id");

-- CreateIndex
CREATE INDEX "WikiDocument_status_idx" ON "WikiDocument"("status");

-- CreateIndex
CREATE INDEX "WikiDocument_slug_idx" ON "WikiDocument"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WikiDocument_project_id_slug_key" ON "WikiDocument"("project_id", "slug");

-- CreateIndex
CREATE INDEX "Comment_user_id_idx" ON "Comment"("user_id");

-- CreateIndex
CREATE INDEX "Comment_file_version_id_idx" ON "Comment"("file_version_id");

-- CreateIndex
CREATE INDEX "Comment_wiki_id_idx" ON "Comment"("wiki_id");

-- CreateIndex
CREATE INDEX "Comment_task_id_idx" ON "Comment"("task_id");

-- CreateIndex
CREATE INDEX "Comment_parent_id_idx" ON "Comment"("parent_id");

-- CreateIndex
CREATE INDEX "Comment_line_number_idx" ON "Comment"("line_number");

-- CreateIndex
CREATE INDEX "Comment_created_at_idx" ON "Comment"("created_at");

-- CreateIndex
CREATE INDEX "TimelineEvent_project_id_idx" ON "TimelineEvent"("project_id");

-- CreateIndex
CREATE INDEX "TimelineEvent_event_type_idx" ON "TimelineEvent"("event_type");

-- CreateIndex
CREATE INDEX "TimelineEvent_occurred_at_idx" ON "TimelineEvent"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadLink_token_key" ON "DownloadLink"("token");

-- CreateIndex
CREATE INDEX "DownloadLink_token_idx" ON "DownloadLink"("token");

-- CreateIndex
CREATE INDEX "DownloadLink_project_id_idx" ON "DownloadLink"("project_id");

-- CreateIndex
CREATE INDEX "DownloadLink_expires_at_idx" ON "DownloadLink"("expires_at");

-- CreateIndex
CREATE INDEX "DownloadLink_is_active_idx" ON "DownloadLink"("is_active");

-- CreateIndex
CREATE INDEX "StorageBackend_is_default_idx" ON "StorageBackend"("is_default");

-- CreateIndex
CREATE INDEX "StorageBackend_is_active_idx" ON "StorageBackend"("is_active");

-- CreateIndex
CREATE INDEX "StorageBackend_backend_type_idx" ON "StorageBackend"("backend_type");

-- CreateIndex
CREATE INDEX "AuditLog_user_id_idx" ON "AuditLog"("user_id");

-- CreateIndex
CREATE INDEX "AuditLog_project_id_idx" ON "AuditLog"("project_id");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resource_type_idx" ON "AuditLog"("resource_type");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- CreateIndex
CREATE INDEX "RecycleBinRecord_user_id_idx" ON "RecycleBinRecord"("user_id");

-- CreateIndex
CREATE INDEX "RecycleBinRecord_resource_type_idx" ON "RecycleBinRecord"("resource_type");

-- CreateIndex
CREATE INDEX "RecycleBinRecord_resource_id_idx" ON "RecycleBinRecord"("resource_id");

-- CreateIndex
CREATE INDEX "RecycleBinRecord_expires_at_idx" ON "RecycleBinRecord"("expires_at");

-- CreateIndex
CREATE INDEX "RecycleBinRecord_restored_at_idx" ON "RecycleBinRecord"("restored_at");
