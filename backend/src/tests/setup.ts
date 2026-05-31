import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../utils/password";
import { signToken } from "../utils/jwt";
import { resetAuthRateLimiters } from "../modules/auth/auth.routes";
import { DEFAULT_ROLE_UPLOAD_POLICY } from "../utils/defaultUploadPolicy";

const basePrisma = new PrismaClient({
  log: process.env.DEBUG_TESTS === "true" ? ["query", "info", "warn", "error"] : [],
});

export const prisma = basePrisma.$extends({
  query: {
    fileEntity: {
      async create({ args, query }) {
        const result = await query(args);
        const file = result as {
          id: string;
          storage_path: string;
          size_bytes: number | bigint;
          checksum: string | null;
        };

        const existingVersion = await basePrisma.fileVersion.findFirst({
          where: { file_id: file.id },
          select: { id: true },
        });

        if (!existingVersion) {
          await basePrisma.fileVersion.create({
            data: {
              file_id: file.id,
              version_number: 0,
              storage_path: file.storage_path,
              size_bytes: file.size_bytes,
              checksum: file.checksum,
              change_summary: "Initial upload",
              is_current: true,
              is_latest: true,
              is_latest_approved: false,
            },
          });
        }

        return result;
      },
    },
  },
});

// ==================== Test Data Factories ====================

export interface TestUserData {
  username?: string;
  password?: string;
  nickname?: string;
  email?: string;
  qq_number?: string;
  role?: "super_admin" | "group_admin" | "supervisor" | "member";
  status?: "active" | "pending_verification" | "disabled";
}

export async function createTestUser(data: TestUserData = {}) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const passwordHash = await hashPassword(data.password || "TestPassword123!");

  const user = await prisma.user.create({
    data: {
      username: data.username || `testuser_${suffix}`,
      password_hash: passwordHash,
      nickname: data.nickname || `Test User ${suffix}`,
      email: data.email || `test_${suffix}@example.com`,
      qq_number: data.qq_number || null,
      role: data.role || "member",
      status: data.status || "active",
    },
  });

  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  const refreshToken = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  return {
    user,
    token,
    refreshToken,
    password: data.password || "TestPassword123!",
  };
}

export async function loginTestUser(userId: string, username: string, role: string) {
  const token = signToken({ userId, username, role });
  const refreshToken = signToken({ userId, username, role });
  return { token, refreshToken };
}

export interface TestProjectData {
  name?: string;
  description?: string;
  project_type?: "anime" | "movie" | "ova" | "special" | "music_video" | "other";
  owner_id: string;
  template_id?: string;
  storage_backend_id?: string;
  qq_group_id?: string | null;
  status?: "draft" | "active" | "paused" | "completed" | "archived" | "cancelled" | "deleted";
  is_archived?: boolean;
  archived_at?: Date;
  deleted_at?: Date;
}

export async function createTestProject(data: TestProjectData) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const project = await prisma.project.create({
    data: {
      name: data.name || `Test Project ${suffix}`,
      description: data.description || "A test project",
      project_type: data.project_type || "anime",
      owner_id: data.owner_id,
      template_id: data.template_id || null,
      storage_backend_id: data.storage_backend_id || null,
      qq_group_id: data.qq_group_id ?? "123456789",
      status: data.status || "draft",
      is_archived: data.is_archived ?? false,
      archived_at: data.archived_at || null,
      deleted_at: data.deleted_at || null,
    },
  });
  return project;
}

export interface TestTemplateData {
  name?: string;
  description?: string;
  project_type?: "anime" | "movie" | "ova" | "special" | "music_video" | "other";
  roles?: Array<{
    role: string;
    enabled: boolean;
    slotCount: number;
    assignmentStrategy: "manual" | "open_claim";
    maxSegmentLength?: number;
    maxSegmentsPerUser?: number;
    requiredTagIds?: string[];
  }>;
  upload_policy?: Record<string, unknown>;
  notification_policy?: Record<string, unknown>;
  ass_policy?: Record<string, unknown>;
  product_config?: Record<string, unknown>;
  delivery_checklist?: Array<Record<string, unknown>>;
  release_task_type?: string;
  is_default?: boolean;
}

export async function createTestTemplate(data: TestTemplateData = {}) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const template = await prisma.projectTemplate.create({
    data: {
      name: data.name || `Test Template ${suffix}`,
      description: data.description || "A test template",
      project_type: data.project_type || "anime",
      roles: JSON.stringify(data.roles || [
        { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "translation", enabled: true, slotCount: 2, assignmentStrategy: "open_claim", maxSegmentsPerUser: 3 },
        { role: "post_production", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "encoding", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "release", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
      ]),
      upload_policy: JSON.stringify(data.upload_policy || DEFAULT_ROLE_UPLOAD_POLICY),
      notification_policy: JSON.stringify(data.notification_policy || { channels: ["in_site"], events: ["all"] }),
      ass_policy: JSON.stringify(data.ass_policy || { format: "ASS", styleRules: [], timingRules: [] }),
      product_config: JSON.stringify(data.product_config || { resolutions: ["1080p"], codecs: ["h264"], containers: ["mkv"] }),
      delivery_checklist: JSON.stringify(data.delivery_checklist || [
        { item: "Source video acquired", required: true },
        { item: "Timing completed", required: true },
        { item: "Translation completed", required: true },
      ]),
      release_task_type: data.release_task_type || "torrent",
      is_default: data.is_default ?? false,
    },
  });
  return template;
}

export interface TestUnitData {
  project_id: string;
  season_number?: number;
  unit_number?: number;
  title?: string;
  episode_length?: number;
}

export async function createTestUnit(data: TestUnitData) {
  const unit = await prisma.projectUnit.create({
    data: {
      project_id: data.project_id,
      season_number: data.season_number || 1,
      unit_number: data.unit_number || 1,
      title: data.title || `Episode ${data.unit_number || 1}`,
      episode_length: data.episode_length || 1440,
    },
  });
  return unit;
}

export interface TestTaskData {
  project_id: string;
  unit_id?: string;
  title?: string;
  description?: string;
  role?: "source" | "timing" | "translation" | "post_production" | "encoding" | "release" | "supervisor";
  status?: "pending_publish" | "claimable" | "assigned" | "in_progress" | "submitted" | "review_approved" | "review_rejected" | "completed" | "overdue" | "frozen";
  assignee_id?: string;
  creator_id: string;
  due_date?: Date;
  completed_at?: Date;
  frozen_at?: Date;
}

export async function createTestTask(data: TestTaskData) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const task = await prisma.task.create({
    data: {
      project_id: data.project_id,
      unit_id: data.unit_id || null,
      title: data.title || `Test Task ${suffix}`,
      description: data.description || "A test task",
      role: data.role || "translation",
      status: data.status || "claimable",
      assignee_id: data.assignee_id || null,
      creator_id: data.creator_id,
      due_date: data.due_date || null,
      completed_at: data.completed_at || null,
      frozen_at: data.frozen_at || null,
    },
  });
  return task;
}

export interface TestFileData {
  project_id: string;
  uploader_id: string;
  name?: string;
  file_type?: "video" | "subtitle" | "font" | "project_package" | "other";
  mime_type?: string;
  size_bytes?: number;
  storage_path?: string;
  storage_backend_id?: string;
  checksum?: string;
  metadata?: string;
  tags?: string;
}

export async function createTestFile(data: TestFileData) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const file = await prisma.fileEntity.create({
    data: {
      project_id: data.project_id,
      uploader_id: data.uploader_id,
      name: data.name || `test_file_${suffix}.ass`,
      original_name: data.name || `test_file_${suffix}.ass`,
      file_type: data.file_type || "subtitle",
      mime_type: data.mime_type || "application/x-ass",
      size_bytes: data.size_bytes || 1024,
      storage_path: data.storage_path || `/uploads/test_${suffix}.ass`,
      storage_backend_id: data.storage_backend_id || null,
      checksum: data.checksum || null,
      metadata: data.metadata || null,
      tags: data.tags || null,
    },
  });

  const version = await prisma.fileVersion.create({
    data: {
      file_id: file.id,
      version_number: 1,
      storage_path: file.storage_path,
      size_bytes: file.size_bytes,
      checksum: file.checksum,
      is_current: true,
      is_latest: true,
      is_latest_approved: false,
    },
  });

  return { file, version };
}

export interface TestStorageBackendData {
  name?: string;
  backend_type?: "local" | "s3" | "s3_compatible";
  config?: Record<string, unknown>;
  is_default?: boolean;
  is_active?: boolean;
  quota_bytes?: number | null;
  used_bytes?: number;
  file_count?: number;
}

export async function createTestStorageBackend(data: TestStorageBackendData = {}) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const backend = await prisma.storageBackend.create({
    data: {
      name: data.name || `Test Backend ${suffix}`,
      backend_type: data.backend_type || "local",
      config: JSON.stringify(data.config || { basePath: "./uploads" }),
      is_default: data.is_default ?? false,
      is_active: data.is_active ?? true,
      quota_bytes: data.quota_bytes ?? null,
      used_bytes: data.used_bytes ?? 0,
      file_count: data.file_count ?? 0,
    },
  });
  return backend;
}

export interface TestNotificationData {
  user_id: string;
  type?: string;
  title?: string;
  content?: string;
  project_id?: string;
  task_id?: string;
  actor_id?: string;
  status?: "unread" | "read" | "dismissed";
  channels?: string;
}

export async function createTestNotification(data: TestNotificationData) {
  const notification = await prisma.notification.create({
    data: {
      user_id: data.user_id,
      type: (data.type as any) || "system",
      title: data.title || "Test Notification",
      content: data.content || "This is a test notification",
      project_id: data.project_id || null,
      task_id: data.task_id || null,
      actor_id: data.actor_id || null,
      status: data.status || "unread",
      channels: data.channels || JSON.stringify(["in_site"]),
    },
  });
  return notification;
}

export async function createTestWiki(data: {
  project_id?: string;
  title?: string;
  slug?: string;
  content?: string;
  pending_content?: string;
  status?: "draft" | "pending" | "approved" | "archived";
  created_by: string;
}) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const wiki = await prisma.wikiDocument.create({
    data: {
      project_id: data.project_id || null,
      title: data.title || `Test Wiki ${suffix}`,
      slug: data.slug || `test-wiki-${suffix}`,
      content: data.content || "# Test Wiki\n\nThis is a test wiki document.",
      pending_content: data.pending_content || null,
      status: data.status || "draft",
      created_by: data.created_by,
    },
  });
  return wiki;
}

export async function createTestAnnouncement(data: {
  type?: "global" | "project" | "system";
  project_id?: string;
  title?: string;
  content?: string;
  is_pinned?: boolean;
  is_active?: boolean;
  created_by: string;
}) {
  const suffix = Math.random().toString(36).substring(2, 10);
  const announcement = await prisma.announcement.create({
    data: {
      type: data.type || "global",
      project_id: data.project_id || null,
      title: data.title || `Test Announcement ${suffix}`,
      content: data.content || "This is a test announcement.",
      is_pinned: data.is_pinned ?? false,
      is_active: data.is_active ?? true,
      created_by: data.created_by,
    },
  });
  return announcement;
}

// ==================== Database Cleanup ====================

const tableNames = [
  "auditLog",
  "timelineEvent",
  "comment",
  "reviewSnapshot",
  "review",
  "subtitleConflict",
  "mergeJob",
  "translationSubmission",
  "translationClaim",
  "taskDependency",
  "downloadLink",
  "linkHistory",
  "fileVersion",
  "fileEntity",
  "notificationDelivery",
  "notification",
  "notificationPreference",
  "wikiDocument",
  "announcement",
  "task",
  "projectUnit",
  "joinRequest",
  "projectMember",
  "uploadPolicy",
  "project",
  "recycleBinRecord",
  "tagApplication",
  "roleTag",
  "verificationChallenge",
  "registrationPolicy",
  "storageBackend",
  "dataRetentionSettings",
  "qqBridgeSettings",
  "smtpSettings",
  "user",
];

export async function cleanDatabase() {
  for (const tableName of tableNames) {
    try {
      // @ts-ignore - dynamic table access
      await prisma[tableName].deleteMany({});
    } catch {
      // Table may not exist or have constraints, ignore
    }
  }
}

// ==================== Jest Setup / Teardown ====================

beforeAll(async () => {
  // Connect to test database
  await prisma.$connect();
});

beforeEach(async () => {
  // Clean database before each test
  await cleanDatabase();
  resetAuthRateLimiters();
});

afterAll(async () => {
  // Clean up and disconnect
  await cleanDatabase();
  await prisma.$disconnect();
});
