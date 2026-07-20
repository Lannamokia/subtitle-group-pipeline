CREATE TABLE "CaptchaProviderProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "encrypted_config" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "recovery_key_salt" TEXT NOT NULL,
    "recovery_key_hash" TEXT NOT NULL,
    "health_status" TEXT,
    "health_error_code" TEXT,
    "last_health_check_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE "CaptchaPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "level" TEXT NOT NULL DEFAULT 'medium',
    "active_provider_id" TEXT,
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE "CaptchaAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider_id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "username_digest" TEXT NOT NULL,
    "ip_digest" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'login',
    "config_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_session_ref" TEXT,
    "verification_digest" TEXT,
    "verification_expires_at" DATETIME,
    "failure_code" TEXT,
    "credentials_failed_at" DATETIME,
    "expires_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    "consumed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaptchaAttempt_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "CaptchaProviderProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CaptchaOutageTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticket_digest" TEXT NOT NULL,
    "username_digest" TEXT NOT NULL,
    "ip_digest" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "config_version" INTEGER NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CaptchaRecoveryAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username_digest" TEXT NOT NULL,
    "ip_digest" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "reason_code" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CaptchaProviderProfile_type_idx" ON "CaptchaProviderProfile"("type");
CREATE INDEX "CaptchaProviderProfile_is_active_idx" ON "CaptchaProviderProfile"("is_active");
CREATE UNIQUE INDEX "CaptchaAttempt_verification_digest_key" ON "CaptchaAttempt"("verification_digest");
CREATE INDEX "CaptchaAttempt_username_digest_created_at_idx" ON "CaptchaAttempt"("username_digest", "created_at");
CREATE INDEX "CaptchaAttempt_status_expires_at_idx" ON "CaptchaAttempt"("status", "expires_at");
CREATE INDEX "CaptchaAttempt_provider_id_idx" ON "CaptchaAttempt"("provider_id");
CREATE UNIQUE INDEX "CaptchaOutageTicket_ticket_digest_key" ON "CaptchaOutageTicket"("ticket_digest");
CREATE INDEX "CaptchaOutageTicket_username_digest_ip_digest_created_at_idx" ON "CaptchaOutageTicket"("username_digest", "ip_digest", "created_at");
CREATE INDEX "CaptchaOutageTicket_expires_at_idx" ON "CaptchaOutageTicket"("expires_at");
CREATE INDEX "CaptchaRecoveryAttempt_username_digest_ip_digest_created_at_idx" ON "CaptchaRecoveryAttempt"("username_digest", "ip_digest", "created_at");
