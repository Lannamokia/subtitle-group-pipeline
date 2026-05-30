ALTER TABLE "QqBridgeSettings" ADD COLUMN "last_heartbeat_at" DATETIME;
ALTER TABLE "QqBridgeSettings" ADD COLUMN "last_heartbeat_status" TEXT;
ALTER TABLE "QqBridgeSettings" ADD COLUMN "last_heartbeat_error" TEXT;
ALTER TABLE "QqBridgeSettings" ADD COLUMN "last_bot_id" TEXT;
ALTER TABLE "QqBridgeSettings" ADD COLUMN "last_bot_nickname" TEXT;
ALTER TABLE "QqBridgeSettings" ADD COLUMN "last_heartbeat_payload" TEXT;
