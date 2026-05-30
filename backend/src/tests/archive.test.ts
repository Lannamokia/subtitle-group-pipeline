import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestUnit,
  createTestTask,
  createTestAnnouncement,
  cleanDatabase,
} from "./setup";
import { post, get, put, del, expectSuccess, expectError } from "./helpers";
import type { Application } from "express";
import { cleanupArchivedProjects } from "../jobs/archive.cleanup";
import { cleanupRecycleBin } from "../jobs/recyclebin.cleanup";

describe("Archive & Lifecycle Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  describe("Project Archive/Unarchive", () => {
    it("should archive a project and freeze active tasks", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id, status: "active" });
      const unit = await createTestUnit({ project_id: project.id });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        creator_id: user.id,
      });
      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "claimable",
        creator_id: user.id,
      });

      const res = await post(app, `/api/v1/projects/${project.id}/archive`, {}, token);

      expectSuccess(res, 200);
      expect(res.body.data.is_archived).toBe(true);
      expect(res.body.data.status).toBe("archived");
      expect(res.body.data.archived_at).not.toBeNull();

      const tasks = await prisma.task.findMany({
        where: { project_id: project.id },
      });
      expect(tasks.every((t) => t.status === "frozen")).toBe(true);
      expect(tasks.every((t) => t.frozen_at !== null)).toBe(true);
    });

    it("should unarchive a project and restore frozen tasks", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({
        owner_id: user.id,
        status: "archived",
        is_archived: true,
        archived_at: new Date(),
      });
      const unit = await createTestUnit({ project_id: project.id });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "frozen",
        frozen_at: new Date(),
        creator_id: user.id,
      });

      const res = await post(app, `/api/v1/projects/${project.id}/unarchive`, {}, token);

      expectSuccess(res, 200);
      expect(res.body.data.is_archived).toBe(false);
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.archived_at).toBeNull();

      const tasks = await prisma.task.findMany({
        where: { project_id: project.id },
      });
      expect(tasks.every((t) => t.status === "claimable")).toBe(true);
      expect(tasks.every((t) => t.frozen_at === null)).toBe(true);
    });

    it("should reject archiving an already archived project", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({
        owner_id: user.id,
        status: "archived",
        is_archived: true,
        archived_at: new Date(),
      });

      const res = await post(app, `/api/v1/projects/${project.id}/archive`, {}, token);

      expectError(res, 400, "BAD_REQUEST");
    });

    it("should reject unarchiving a non-archived project", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id, status: "active" });

      const res = await post(app, `/api/v1/projects/${project.id}/unarchive`, {}, token);

      expectError(res, 400, "BAD_REQUEST");
    });
  });

  describe("Soft-Delete and Recycle Bin", () => {
    it("should soft-delete an archived project and create recycle bin record", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({
        owner_id: user.id,
        status: "archived",
        is_archived: true,
        archived_at: new Date(),
      });

      const res = await del(app, `/api/v1/projects/${project.id}`, token);

      expectSuccess(res, 200);

      const deletedProject = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(deletedProject!.deleted_at).not.toBeNull();
      expect(deletedProject!.status).toBe("deleted");

      const recycleBinRecord = await prisma.recycleBinRecord.findFirst({
        where: { resource_type: "project", resource_id: project.id },
      });
      expect(recycleBinRecord).toBeDefined();
      expect(recycleBinRecord!.resource_type).toBe("project");
      expect(recycleBinRecord!.resource_id).toBe(project.id);
      expect(recycleBinRecord!.expires_at).not.toBeNull();
      expect(recycleBinRecord!.restored_at).toBeNull();
    });

    it("should require project to be archived before deletion", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id, status: "active" });

      const res = await del(app, `/api/v1/projects/${project.id}`, token);

      expectError(res, 400, "BAD_REQUEST");
    });

    it("should restore a deleted project from recycle bin", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({
        owner_id: user.id,
        status: "archived",
        is_archived: true,
        archived_at: new Date(),
      });

      await del(app, `/api/v1/projects/${project.id}`, token);

      const res = await post(
        app,
        `/api/v1/projects/${project.id}/restore`,
        {},
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.deleted_at).toBeNull();
      expect(res.body.data.status).toBe("archived");
      expect(res.body.data.is_archived).toBe(true);

      const recycleBinRecord = await prisma.recycleBinRecord.findFirst({
        where: { resource_type: "project", resource_id: project.id },
      });
      expect(recycleBinRecord!.restored_at).not.toBeNull();
    });

    it("should reject restoring a non-deleted project", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const res = await post(
        app,
        `/api/v1/projects/${project.id}/restore`,
        {},
        token
      );

      expectError(res, 400, "BAD_REQUEST");
    });
  });

  describe("Archive Retention Cleanup", () => {
    it("should preserve only final versions during cleanup", async () => {
      const { user } = await createTestUser();
      await prisma.dataRetentionSettings.create({
        data: { archive_retention_days: 1 },
      });
      const project = await createTestProject({
        owner_id: user.id,
        status: "archived",
        is_archived: true,
        archived_at: new Date(Date.now() - 3 * 86400000),
      });

      // Create file with multiple versions
      const file = await prisma.fileEntity.create({
        data: {
          project_id: project.id,
          uploader_id: user.id,
          name: "test.ass",
          original_name: "test.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 1024,
          storage_path: "/uploads/test.ass",
        },
      });

      // Create multiple versions
      for (let i = 1; i <= 5; i++) {
        await prisma.fileVersion.create({
          data: {
            file_id: file.id,
            version_number: i,
            storage_path: `/uploads/test_v${i}.ass`,
            size_bytes: 1024,
            is_current: i === 5,
            is_latest: i === 5,
            is_latest_approved: i === 3,
            approved_by: i === 3 ? user.id : null,
            approved_at: i === 3 ? new Date(Date.now() - 2 * 86400000) : null,
          },
        });
      }

      const allVersions = await prisma.fileVersion.findMany({
        where: { file_id: file.id },
      });
      expect(allVersions.length).toBe(6);

      await cleanupArchivedProjects();

      const remainingVersions = await prisma.fileVersion.findMany({
        where: { file_id: file.id },
        orderBy: { version_number: "asc" },
      });

      expect(remainingVersions).toHaveLength(1);
      expect(remainingVersions[0].version_number).toBe(3);
      expect(remainingVersions[0].is_current).toBe(true);
      expect(remainingVersions[0].is_latest).toBe(true);
      expect(remainingVersions[0].is_latest_approved).toBe(true);
    });

    it("should skip soft-deleted archived projects during archive cleanup", async () => {
      const { user } = await createTestUser();
      await prisma.dataRetentionSettings.create({
        data: { archive_retention_days: 1 },
      });
      const project = await createTestProject({
        owner_id: user.id,
        status: "deleted",
        is_archived: true,
        archived_at: new Date(Date.now() - 3 * 86400000),
        deleted_at: new Date(Date.now() - 2 * 86400000),
      });
      const file = await prisma.fileEntity.create({
        data: {
          project_id: project.id,
          uploader_id: user.id,
          name: "deleted-project.ass",
          original_name: "deleted-project.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 1024,
          storage_path: "/uploads/deleted-project.ass",
        },
      });

      for (let i = 1; i <= 3; i++) {
        await prisma.fileVersion.create({
          data: {
            file_id: file.id,
            version_number: i,
            storage_path: `/uploads/deleted_project_v${i}.ass`,
            size_bytes: 1024,
            is_current: i === 3,
            is_latest: i === 3,
            is_latest_approved: i === 2,
            approved_by: i === 2 ? user.id : null,
            approved_at: i === 2 ? new Date(Date.now() - 2 * 86400000) : null,
          },
        });
      }

      await cleanupArchivedProjects();

      const remainingVersions = await prisma.fileVersion.findMany({
        where: { file_id: file.id },
      });
      expect(remainingVersions).toHaveLength(4);
    });

    it("should clean up expired recycle bin records", async () => {
      const { user } = await createTestUser();

      // Create expired recycle bin record
      await prisma.recycleBinRecord.create({
        data: {
          user_id: user.id,
          resource_type: "project",
          resource_id: "expired-project-id",
          resource_data: JSON.stringify({ name: "Old Project" }),
          expires_at: new Date(Date.now() - 86400000), // 1 day ago
        },
      });

      // Create non-expired record
      await prisma.recycleBinRecord.create({
        data: {
          user_id: user.id,
          resource_type: "file",
          resource_id: "active-file-id",
          resource_data: JSON.stringify({ name: "Active File" }),
          expires_at: new Date(Date.now() + 86400000), // 1 day from now
        },
      });

      await cleanupRecycleBin();

      const expiredRecords = await prisma.recycleBinRecord.findMany({
        where: { resource_id: "expired-project-id" },
      });
      const activeRecords = await prisma.recycleBinRecord.findMany({
        where: { resource_id: "active-file-id" },
      });

      expect(expiredRecords).toHaveLength(0);
      expect(activeRecords).toHaveLength(1);
    });

    it("should bypass cleanup for restored items", async () => {
      const { user } = await createTestUser();

      await prisma.recycleBinRecord.create({
        data: {
          user_id: user.id,
          resource_type: "project",
          resource_id: "restored-project-id",
          resource_data: JSON.stringify({ name: "Restored Project" }),
          expires_at: new Date(Date.now() - 86400000),
          restored_at: new Date(),
        },
      });

      await cleanupRecycleBin();

      const restoredRecords = await prisma.recycleBinRecord.findMany({
        where: { restored_at: { not: null } },
      });

      expect(restoredRecords.length).toBe(1);
    });

    it("should permanently delete a recycled project on demand", async () => {
      const { user, token } = await createTestUser({ role: "group_admin" });
      const project = await createTestProject({
        owner_id: user.id,
        status: "deleted",
        is_archived: true,
        archived_at: new Date(),
        deleted_at: new Date(),
      });

      await prisma.recycleBinRecord.create({
        data: {
          user_id: user.id,
          resource_type: "project",
          resource_id: project.id,
          resource_data: JSON.stringify({ name: project.name }),
          expires_at: new Date(Date.now() + 86400000),
        },
      });

      const res = await del(app, `/api/v1/projects/${project.id}/permanent`, token);

      expectSuccess(res, 200);
      expect(res.body.data.deleted).toBe(true);

      const deletedProject = await prisma.project.findUnique({ where: { id: project.id } });
      const recycleRecords = await prisma.recycleBinRecord.findMany({
        where: { resource_id: project.id },
      });

      expect(deletedProject).toBeNull();
      expect(recycleRecords).toHaveLength(0);
    });
  });

  describe("Restoration Bypassing Cleanup", () => {
    it("should restore project even if recycle bin record is expired", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({
        owner_id: user.id,
        status: "archived",
        is_archived: true,
        archived_at: new Date(),
        deleted_at: new Date(),
      });

      await prisma.recycleBinRecord.create({
        data: {
          user_id: user.id,
          resource_type: "project",
          resource_id: project.id,
          resource_data: JSON.stringify({ name: project.name }),
          expires_at: new Date(Date.now() - 86400000), // Expired
        },
      });

      // Restore should still work
      const res = await post(
        app,
        `/api/v1/projects/${project.id}/restore`,
        {},
        token
      );

      expectSuccess(res, 200);

      const restored = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(restored!.deleted_at).toBeNull();
    });
  });

  describe("Announcement CRUD", () => {
    it("should create a global announcement", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });

      const res = await post(
        app,
        "/api/v1/announcements",
        {
          type: "global",
          title: "System Maintenance",
          content: "The system will be down for maintenance tonight.",
          is_pinned: true,
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.title).toBe("System Maintenance");
      expect(res.body.data.type).toBe("global");
      expect(res.body.data.is_pinned).toBe(true);
      expect(res.body.data.created_by).toBe(user.id);
    });

    it("should create a project announcement", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: user.id, role: "supervisor", is_lead: true },
      });

      const res = await post(
        app,
        "/api/v1/announcements",
        {
          type: "project",
          project_id: project.id,
          title: "New Episode Released",
          content: "Episode 1 is now available for download.",
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.type).toBe("project");
      expect(res.body.data.project_id).toBe(project.id);
    });

    it("should reject project announcement by non-supervisor", async () => {
      const { user: owner } = await createTestUser();
      const { user: regular, token: regularToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: regular.id, role: "translation" },
      });

      const res = await post(
        app,
        "/api/v1/announcements",
        {
          type: "project",
          project_id: project.id,
          title: "Unauthorized",
          content: "Should fail",
        },
        regularToken
      );

      expectError(res, 403, "FORBIDDEN");
    });

    it("should retrieve announcements with pagination", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });

      for (let i = 0; i < 5; i++) {
        await createTestAnnouncement({
          type: "global",
          title: `Announcement ${i}`,
          created_by: user.id,
        });
      }

      const res = await get(app, "/api/v1/announcements?page=1&pageSize=3", token);

      expectSuccess(res, 200);
      expect(res.body.data.announcements.length).toBe(3);
      expect(res.body.meta.total).toBe(5);
    });

    it("should filter active announcements", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });

      await createTestAnnouncement({
        type: "global",
        title: "Active Announcement",
        is_active: true,
        created_by: user.id,
      });

      await createTestAnnouncement({
        type: "global",
        title: "Inactive Announcement",
        is_active: false,
        created_by: user.id,
      });

      const res = await get(app, "/api/v1/announcements", token);

      expectSuccess(res, 200);
      expect(res.body.data.announcements.length).toBe(1);
      expect(res.body.data.announcements[0].title).toBe("Active Announcement");
    });

    it("should update an announcement", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });
      const announcement = await createTestAnnouncement({
        type: "global",
        title: "Original Title",
        created_by: user.id,
      });

      const res = await put(
        app,
        `/api/v1/announcements/${announcement.id}`,
        { title: "Updated Title", content: "Updated content" },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.title).toBe("Updated Title");
      expect(res.body.data.content).toBe("Updated content");
    });

    it("should delete an announcement", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });
      const announcement = await createTestAnnouncement({
        type: "global",
        created_by: user.id,
      });

      const res = await del(app, `/api/v1/announcements/${announcement.id}`, token);

      expectSuccess(res, 200);

      const deleted = await prisma.announcement.findUnique({
        where: { id: announcement.id },
      });
      expect(deleted).toBeNull();
    });

    it("should pin and unpin announcements", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });
      const announcement = await createTestAnnouncement({
        type: "global",
        is_pinned: false,
        created_by: user.id,
      });

      const pinRes = await post(
        app,
        `/api/v1/announcements/${announcement.id}/pin`,
        { pinned: true },
        token
      );

      expectSuccess(pinRes, 200);
      expect(pinRes.body.data.is_pinned).toBe(true);

      const unpinRes = await post(
        app,
        `/api/v1/announcements/${announcement.id}/pin`,
        { pinned: false },
        token
      );

      expectSuccess(unpinRes, 200);
      expect(unpinRes.body.data.is_pinned).toBe(false);
    });

    it("should sort announcements with pinned first", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });

      await createTestAnnouncement({
        type: "global",
        title: "Regular",
        is_pinned: false,
        created_by: user.id,
      });

      await createTestAnnouncement({
        type: "global",
        title: "Pinned",
        is_pinned: true,
        created_by: user.id,
      });

      const res = await get(app, "/api/v1/announcements", token);

      expectSuccess(res, 200);
      expect(res.body.data.announcements[0].title).toBe("Pinned");
      expect(res.body.data.announcements[0].is_pinned).toBe(true);
    });
  });
});
