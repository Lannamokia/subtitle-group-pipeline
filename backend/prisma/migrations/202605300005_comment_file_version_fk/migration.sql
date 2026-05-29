PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Comment" (
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
    CONSTRAINT "Comment_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "FileVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Comment_wiki_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "WikiDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Comment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Comment" (
    "id",
    "user_id",
    "content",
    "file_version_id",
    "wiki_id",
    "task_id",
    "line_number",
    "parent_id",
    "created_at",
    "updated_at",
    "deleted_at"
)
SELECT
    c."id",
    c."user_id",
    c."content",
    CASE
      WHEN c."file_version_id" IS NULL THEN NULL
      WHEN fv."id" IS NOT NULL THEN c."file_version_id"
      ELSE (
        SELECT v."id"
        FROM "FileVersion" v
        WHERE v."file_id" = c."file_version_id"
        ORDER BY v."is_current" DESC, v."is_latest_approved" DESC, v."version_number" DESC
        LIMIT 1
      )
    END,
    c."wiki_id",
    c."task_id",
    c."line_number",
    c."parent_id",
    c."created_at",
    c."updated_at",
    c."deleted_at"
FROM "Comment" c
LEFT JOIN "FileVersion" fv ON fv."id" = c."file_version_id";

DROP TABLE "Comment";
ALTER TABLE "new_Comment" RENAME TO "Comment";

CREATE INDEX "Comment_user_id_idx" ON "Comment"("user_id");
CREATE INDEX "Comment_file_version_id_idx" ON "Comment"("file_version_id");
CREATE INDEX "Comment_wiki_id_idx" ON "Comment"("wiki_id");
CREATE INDEX "Comment_task_id_idx" ON "Comment"("task_id");
CREATE INDEX "Comment_parent_id_idx" ON "Comment"("parent_id");
CREATE INDEX "Comment_line_number_idx" ON "Comment"("line_number");
CREATE INDEX "Comment_created_at_idx" ON "Comment"("created_at");

PRAGMA foreign_keys=ON;
