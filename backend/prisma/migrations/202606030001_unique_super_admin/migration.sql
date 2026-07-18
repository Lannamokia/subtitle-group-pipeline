-- Keep the oldest super administrator as the canonical account when upgrading
-- an installation that already contains duplicates.
ALTER TABLE "User" ADD COLUMN "super_admin_marker" TEXT;

UPDATE "User"
SET "role" = 'group_admin'
WHERE "role" = 'super_admin'
  AND "id" <> (
    SELECT "id"
    FROM "User"
    WHERE "role" = 'super_admin'
    ORDER BY "created_at" ASC, "id" ASC
    LIMIT 1
  );

UPDATE "User"
SET "super_admin_marker" = 'singleton'
WHERE "role" = 'super_admin';

CREATE UNIQUE INDEX "User_super_admin_marker_key" ON "User"("super_admin_marker");
