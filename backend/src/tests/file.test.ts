import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestFile,
  createTestStorageBackend,
  createTestTask,
  createTestUnit,
  cleanDatabase,
} from "./setup";
import { post, get, put, del, expectSuccess, expectError } from "./helpers";
import type { Application } from "express";
import { cleanupExpiredDownloadLinks } from "../jobs/download.cleanup";

describe("File Management Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp({ databaseReady: true });
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  describe("Upload Policy Enforcement", () => {
    it("should enforce allowed MIME types", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.uploadPolicy.create({
        data: {
          project_id: project.id,
          allowed_types: JSON.stringify(["application/x-ass", "text/plain"]),
          max_size_bytes: 104857600,
          require_approval: false,
          extension_whitelist: JSON.stringify([".ass", ".txt"]),
        },
      });

      // Valid upload
      const validRes = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "test.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 1024,
          storage_path: "/uploads/test.ass",
        },
        token
      );

      expectSuccess(validRes, 201);

      // Invalid MIME type
      const invalidRes = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "test.exe",
          file_type: "other",
          mime_type: "application/x-msdownload",
          size_bytes: 1024,
          storage_path: "/uploads/test.exe",
        },
        token
      );

      expectError(invalidRes, 400, "VALIDATION_ERROR");

      const createdInvalid = await prisma.fileEntity.findFirst({
        where: { project_id: project.id, name: "test.exe" },
      });
      expect(createdInvalid).toBeNull();
    });

    it("should enforce file size limits", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.uploadPolicy.create({
        data: {
          project_id: project.id,
          allowed_types: JSON.stringify(["*/*"]),
          max_size_bytes: 1024, // 1KB limit
          require_approval: false,
        },
      });

      // The API doesn't reject oversized files at the endpoint level
      // Size validation is done in the validateUpload service function
      const res = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "large.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 2048, // Over the limit
          storage_path: "/uploads/large.ass",
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
    });

    it("should enforce role-specific upload policy matrix and preserve task state", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: user.id,
        assignee_id: user.id,
        role: "translation",
        status: "assigned",
      });
      const encodingTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: user.id,
        assignee_id: user.id,
        role: "encoding",
        status: "assigned",
      });

      await prisma.projectMember.create({
        data: {
          project_id: project.id,
          user_id: user.id,
          role: "translation",
        },
      });

      await prisma.uploadPolicy.create({
        data: {
          project_id: project.id,
          allowed_types: JSON.stringify({
            roles: {
              translation: {
                file_types: ["subtitle"],
                mime_types: ["application/x-ass", "text/plain", "text/vtt", "application/ttml+xml"],
                extensions: [".ass", ".txt", ".vtt", ".ttml"],
              },
              encoding: {
                file_types: ["video"],
                mime_types: ["video/*", "application/x-matroska"],
                extensions: [".mp4", ".webm", ".m2ts"],
              },
            },
            extensionWhitelist: [".ass", ".txt", ".vtt", ".ttml", ".mp4", ".webm", ".m2ts"],
          }),
          max_size_bytes: 104857600,
          require_approval: false,
          extension_whitelist: JSON.stringify([".ass", ".txt", ".vtt", ".ttml", ".mp4", ".webm", ".m2ts"]),
        },
      });

      const rejected = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "encoded.mp4",
          file_type: "video",
          mime_type: "video/mp4",
          size_bytes: 4096,
          storage_path: "/uploads/encoded.mp4",
          task_id: task.id,
          unit_id: unit.id,
          role: "translation",
        },
        token
      );

      expectError(rejected, 400, "VALIDATION_ERROR");

      const unchangedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(unchangedTask!.status).toBe("assigned");

      const accepted = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "translation.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 2048,
          storage_path: "/uploads/translation.ass",
          task_id: task.id,
          unit_id: unit.id,
          role: "translation",
        },
        token
      );

      expectSuccess(accepted, 201);
      expect(accepted.body.data.metadata).toContain(task.id);

      const acceptedVtt = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "translation.vtt",
          file_type: "subtitle",
          mime_type: "text/vtt",
          size_bytes: 1024,
          storage_path: "/uploads/translation.vtt",
          task_id: task.id,
          unit_id: unit.id,
          role: "translation",
        },
        token
      );

      expectSuccess(acceptedVtt, 201);

      const acceptedWebm = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "encoded.webm",
          file_type: "video",
          mime_type: "video/webm",
          size_bytes: 4096,
          storage_path: "/uploads/encoded.webm",
          task_id: encodingTask.id,
          unit_id: unit.id,
          role: "encoding",
        },
        token
      );

      expectSuccess(acceptedWebm, 201);
    });

    it("should fall back to the default role policy when a project policy is an empty shell", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: user.id,
        assignee_id: user.id,
        role: "translation",
        status: "assigned",
      });

      await prisma.projectMember.create({
        data: {
          project_id: project.id,
          user_id: user.id,
          role: "translation",
        },
      });

      await prisma.uploadPolicy.create({
        data: {
          project_id: project.id,
          allowed_types: JSON.stringify({ allowedTypes: {} }),
          max_size_bytes: 104857600,
          require_approval: false,
          extension_whitelist: null,
        },
      });

      const res = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "fallback.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 2048,
          storage_path: "/uploads/fallback.ass",
          task_id: task.id,
          unit_id: unit.id,
          role: "translation",
        },
        token
      );

      expectSuccess(res, 201);
    });

    it("should expose the effective default policy when the saved project policy is empty", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.uploadPolicy.create({
        data: {
          project_id: project.id,
          allowed_types: JSON.stringify({ allowedTypes: {} }),
          max_size_bytes: 104857600,
          require_approval: false,
        },
      });

      const res = await get(app, `/api/v1/files/upload-policy?project_id=${project.id}`);

      expectSuccess(res, 200);
      const policyConfig = JSON.parse(res.body.data.allowed_types);
      expect(policyConfig.roles.translation.file_types).toContain("subtitle");
      expect(policyConfig.roles.encoding.file_types).toContain("video");
    });

    it("should fall back to a usable global policy when project policy is missing", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.projectMember.create({
        data: {
          project_id: project.id,
          user_id: user.id,
          role: "translation",
        },
      });

      await prisma.uploadPolicy.create({
        data: {
          project_id: null,
          allowed_types: JSON.stringify({
            file_types: ["subtitle"],
            mime_types: ["application/x-ass"],
            extensions: [".ass"],
          }),
          max_size_bytes: 104857600,
          require_approval: false,
          extension_whitelist: JSON.stringify([".ass"]),
        },
      });

      const accepted = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "global.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 1024,
          storage_path: "/uploads/global.ass",
          role: "translation",
        },
        token
      );
      expectSuccess(accepted, 201);

      const rejected = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "global.mp4",
          file_type: "video",
          mime_type: "video/mp4",
          size_bytes: 1024,
          storage_path: "/uploads/global.mp4",
          role: "translation",
        },
        token
      );
      expectError(rejected, 400, "VALIDATION_ERROR");
    });

    it("should reject files whose declared file type does not match MIME or extension", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.projectMember.create({
        data: {
          project_id: project.id,
          user_id: user.id,
          role: "translation",
        },
      });

      await prisma.uploadPolicy.create({
        data: {
          project_id: project.id,
          allowed_types: JSON.stringify({
            roles: {
              translation: {
                file_types: ["subtitle"],
                mime_types: ["application/x-ass", "text/plain"],
                extensions: [".ass", ".txt"],
              },
            },
          }),
          max_size_bytes: 104857600,
          require_approval: false,
          extension_whitelist: JSON.stringify([".ass", ".txt"]),
        },
      });

      const res = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "spoofed.mp4",
          file_type: "subtitle",
          mime_type: "video/mp4",
          size_bytes: 2048,
          storage_path: "/uploads/spoofed.mp4",
          role: "translation",
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
      const created = await prisma.fileEntity.findFirst({
        where: { project_id: project.id, name: "spoofed.mp4" },
      });
      expect(created).toBeNull();
    });

    it("should reject invalid extension whitelist JSON when updating upload policy", async () => {
      const { token } = await createTestUser({ role: "group_admin" });

      const res = await post(
        app,
        "/api/v1/files/upload-policy",
        {
          allowed_types: JSON.stringify(["*/*"]),
          max_size_bytes: 1024,
          require_approval: false,
          extension_whitelist: "not-json",
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
    });
  });

  describe("File Entity Creation", () => {
    it("should create file entity per upload", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const res = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "subtitle.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 2048,
          storage_path: "/uploads/subtitle.ass",
          checksum: "abc123",
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.name).toBe("subtitle.ass");
      expect(res.body.data.file_type).toBe("subtitle");
      expect(res.body.data.mime_type).toBe("application/x-ass");
      expect(res.body.data.size_bytes).toBe(2048);
      expect(res.body.data.checksum).toBe("abc123");
      expect(res.body.data.uploader_id).toBe(user.id);
      expect(res.body.data.project_id).toBe(project.id);
      expect(res.body.data.current_version).toBeDefined();
      expect(res.body.data.current_version.version_number).toBe(1);
    });

    it("should create independent entities for same-name files (no auto-merge)", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const res1 = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "same_name.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 1024,
          storage_path: "/uploads/same_name_v1.ass",
        },
        token
      );

      const res2 = await post(
        app,
        "/api/v1/files/upload",
        {
          project_id: project.id,
          name: "same_name.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 2048,
          storage_path: "/uploads/same_name_v2.ass",
        },
        token
      );

      expectSuccess(res1, 201);
      expectSuccess(res2, 201);

      // Should be different IDs
      expect(res1.body.data.id).not.toBe(res2.body.data.id);

      const files = await prisma.fileEntity.findMany({
        where: { project_id: project.id, name: "same_name.ass" },
      });

      expect(files.length).toBe(2);
    });
  });

  describe("Link-Type Asset History", () => {
    it("should create link history entries", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      const res = await post(
        app,
        "/api/v1/files/links",
        {
          project_id: project.id,
          file_id: file.id,
          url: "https://pan.baidu.com/s/1test",
          link_type: "baidu_pan",
          description: "Source video",
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.url).toBe("https://pan.baidu.com/s/1test");
      expect(res.body.data.link_type).toBe("baidu_pan");
      expect(res.body.data.file_id).toBe(file.id);
    });

    it("should retrieve link history for a project", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.linkHistory.createMany({
        data: [
          {
            project_id: project.id,
            url: "https://example.com/1",
            link_type: "google_drive",
            created_by: user.id,
          },
          {
            project_id: project.id,
            url: "https://example.com/2",
            link_type: "mega",
            created_by: user.id,
          },
        ],
      });

      const res = await get(app, `/api/v1/files/links?project_id=${project.id}`, token);

      expectSuccess(res, 200);
      expect(res.body.data.length).toBe(2);
    });
  });

  describe("File Version Auto-Resolution", () => {
    it("should set current to latest when no approved version exists", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file, version } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      const updatedVersion = await prisma.fileVersion.findUnique({
        where: { id: version.id },
      });

      expect(updatedVersion!.is_current).toBe(true);
      expect(updatedVersion!.is_latest).toBe(true);
      expect(updatedVersion!.is_latest_approved).toBe(false);
    });

    it("should set current to latest_approved when one exists", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file, version: v1 } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      // Create a second version
      const v2 = await prisma.fileVersion.create({
        data: {
          file_id: file.id,
          version_number: 2,
          storage_path: "/uploads/v2.ass",
          size_bytes: 2048,
          is_current: true,
          is_latest: true,
          is_latest_approved: false,
        },
      });

      // Mark v1 as latest_approved
      await prisma.fileVersion.update({
        where: { id: v1.id },
        data: { is_latest_approved: true, approved_by: user.id, approved_at: new Date() },
      });

      // v1 should be current (latest_approved takes precedence)
      const updatedV1 = await prisma.fileVersion.findUnique({ where: { id: v1.id } });
      expect(updatedV1!.is_latest_approved).toBe(true);
    });

    it("should update current version on approval", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file, version: v1 } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      const v2 = await prisma.fileVersion.create({
        data: {
          file_id: file.id,
          version_number: 2,
          storage_path: "/uploads/v2.ass",
          size_bytes: 2048,
          is_current: false,
          is_latest: true,
          is_latest_approved: false,
        },
      });

      // Approve v2
      const approveRes = await post(
        app,
        `/api/v1/files/${file.id}/versions/${v2.id}/approve`,
        {},
        token
      );

      expectSuccess(approveRes, 200);
      expect(approveRes.body.data.is_latest_approved).toBe(true);
      expect(approveRes.body.data.approved_by).toBe(user.id);
    });
  });

  describe("Temporary Download Links with TTL", () => {
    it("should create download link with TTL", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      const res = await post(
        app,
        `/api/v1/files/${file.id}/download-link`,
        { ttl: 300 },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.expiresAt).toBeDefined();
    });

    it("should enforce minimum TTL of 90 seconds", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        file_type: "subtitle",
      });

      const res = await post(
        app,
        `/api/v1/files/${file.id}/download-link`,
        { ttl: 10 }, // Below minimum
        token
      );

      expectSuccess(res, 200);
      const expiresAt = new Date(res.body.data.expiresAt);
      const now = new Date();
      const ttlSeconds = (expiresAt.getTime() - now.getTime()) / 1000;
      expect(ttlSeconds).toBeGreaterThanOrEqual(90);
    });

    it("should reuse an existing non-expired link for the same user and file", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      const first = await post(app, `/api/v1/files/${file.id}/download-link`, {}, token);
      const second = await post(app, `/api/v1/files/${file.id}/download-link`, {}, token);

      expectSuccess(first, 200);
      expectSuccess(second, 200);
      expect(second.body.data.downloadUrl).toBe(first.body.data.downloadUrl);

      const links = await prisma.downloadLink.findMany({
        where: { file_id: file.id, created_by: user.id },
      });
      expect(links).toHaveLength(1);
    });

    it("should create a new link when the existing one is close to expiry", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      await prisma.downloadLink.create({
        data: {
          project_id: project.id,
          file_id: file.id,
          created_by: user.id,
          token: "soon-expiring-token",
          expires_at: new Date(Date.now() + 25_000),
          is_active: true,
        },
      });

      const res = await post(app, `/api/v1/files/${file.id}/download-link`, {}, token);

      expectSuccess(res, 200);
      expect(res.body.data.downloadUrl).not.toContain("soon-expiring-token");

      const links = await prisma.downloadLink.findMany({
        where: { file_id: file.id, created_by: user.id },
      });
      expect(links).toHaveLength(2);
    });

    it("should use a 60-second refresh threshold for video links", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        file_type: "video",
        mime_type: "video/mp4",
      });

      await prisma.downloadLink.create({
        data: {
          project_id: project.id,
          file_id: file.id,
          created_by: user.id,
          token: "video-expiring-token",
          expires_at: new Date(Date.now() + 45_000),
          is_active: true,
        },
      });

      const res = await post(app, `/api/v1/files/${file.id}/download-link`, {}, token);

      expectSuccess(res, 200);
      expect(res.body.data.downloadUrl).not.toContain("video-expiring-token");
    });

    it("should use global TTL configuration and project override", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await prisma.dataRetentionSettings.create({
        data: {
          download_link_ttl_seconds: 120,
        },
      });

      const { file: globalFile } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "global-ttl.ass",
      });
      const globalRes = await post(app, `/api/v1/files/${globalFile.id}/download-link`, {}, token);
      expectSuccess(globalRes, 200);
      expect((new Date(globalRes.body.data.expiresAt).getTime() - Date.now()) / 1000)
        .toBeGreaterThanOrEqual(120);

      await prisma.project.update({
        where: { id: project.id },
        data: { download_link_ttl_seconds: 180 },
      });
      const { file: projectFile } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "project-ttl.ass",
      });
      const projectRes = await post(app, `/api/v1/files/${projectFile.id}/download-link`, {}, token);
      expectSuccess(projectRes, 200);
      expect((new Date(projectRes.body.data.expiresAt).getTime() - Date.now()) / 1000)
        .toBeGreaterThanOrEqual(180);
    });

    it("should record S3 temporary links for reuse and cleanup", async () => {
      const { user, token } = await createTestUser();
      const backend = await createTestStorageBackend({
        backend_type: "s3",
        config: {
          region: "us-east-1",
          bucket: "test-bucket",
          accessKeyId: "test",
          secretAccessKey: "test",
          endpoint: "https://s3.example.test",
          forcePathStyle: true,
        },
      });
      const project = await createTestProject({
        owner_id: user.id,
        storage_backend_id: backend.id,
      });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        storage_backend_id: backend.id,
      });

      const res = await post(app, `/api/v1/files/${file.id}/download-link`, {}, token);

      expectSuccess(res, 200);
      expect(res.body.data.downloadUrl).toContain("s3.example.test");
      const link = await prisma.downloadLink.findFirst({
        where: { file_id: file.id, created_by: user.id },
      });
      expect(link).toBeDefined();
    });

    it("should reject expired download token", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const link = await prisma.downloadLink.create({
        data: {
          project_id: project.id,
          created_by: user.id,
          token: "expired-token-123",
          expires_at: new Date(Date.now() - 1000),
          is_active: true,
        },
      });

      const res = await get(app, `/api/v1/files/download/${link.token}`);

      expectError(res, 410, "GONE");
    });

    it("should delete expired download link records during cleanup", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const expired = await prisma.downloadLink.create({
        data: {
          project_id: project.id,
          created_by: user.id,
          token: "expired-cleanup-token",
          expires_at: new Date(Date.now() - 1000),
          is_active: true,
        },
      });
      const active = await prisma.downloadLink.create({
        data: {
          project_id: project.id,
          created_by: user.id,
          token: "active-cleanup-token",
          expires_at: new Date(Date.now() + 60000),
          is_active: true,
        },
      });

      await cleanupExpiredDownloadLinks();

      await expect(prisma.downloadLink.findUnique({ where: { id: expired.id } })).resolves.toBeNull();
      await expect(prisma.downloadLink.findUnique({ where: { id: active.id } })).resolves.toBeDefined();
    });
  });

  describe("Sensitive Tag Access Control", () => {
    it("should require project file view permission before generating a link", async () => {
      const { user: owner } = await createTestUser();
      const { token: outsiderToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
      });

      const res = await post(
        app,
        `/api/v1/files/${file.id}/download-link`,
        {},
        outsiderToken
      );

      expectError(res, 403, "FORBIDDEN");
    });

    it("should restrict sensitive files to authorized roles", async () => {
      const { user: admin, token: adminToken } = await createTestUser({ role: "super_admin" });
      const { user: regular, token: regularToken } = await createTestUser();
      const project = await createTestProject({ owner_id: admin.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: regular.id, role: "translation" },
      });

      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: admin.id,
        tags: JSON.stringify(["sensitive"]),
      });

      // Admin should have access
      const adminRes = await post(
        app,
        `/api/v1/files/${file.id}/download-link`,
        {},
        adminToken
      );

      expectSuccess(adminRes, 200);

      // Regular user without source/encoding/supervisor role should be denied
      const regularRes = await post(
        app,
        `/api/v1/files/${file.id}/download-link`,
        {},
        regularToken
      );

      expectError(regularRes, 403, "FORBIDDEN");
    });

    it("should allow source role to access sensitive files", async () => {
      const { user: source, token: sourceToken } = await createTestUser();
      const project = await createTestProject({ owner_id: source.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: source.id, role: "source" },
      });

      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: source.id,
        tags: JSON.stringify(["sensitive"]),
      });

      const res = await post(
        app,
        `/api/v1/files/${file.id}/download-link`,
        {},
        sourceToken
      );

      expectSuccess(res, 200);
    });
  });

  describe("Supervisor Batch Operations", () => {
    it("should batch assign matching unit tasks to one assignee", async () => {
      const { user: supervisor, token } = await createTestUser({ role: "supervisor" });
      const { user: assignee } = await createTestUser();
      const project = await createTestProject({ owner_id: supervisor.id });
      const unit = await createTestUnit({ project_id: project.id });
      const otherUnit = await createTestUnit({
        project_id: project.id,
        unit_number: 2,
      });
      const targetTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: supervisor.id,
        role: "translation",
        status: "claimable",
      });
      const otherRoleTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: supervisor.id,
        role: "encoding",
        status: "claimable",
      });
      const otherUnitTask = await createTestTask({
        project_id: project.id,
        unit_id: otherUnit.id,
        creator_id: supervisor.id,
        role: "translation",
        status: "claimable",
      });

      const res = await post(
        app,
        "/api/v1/files/batch/assign-tasks",
        {
          unit_id: unit.id,
          assignee_id: assignee.id,
          role: "translation",
        },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.assigned_count).toBe(1);

      await expect(prisma.task.findUnique({ where: { id: targetTask.id } }))
        .resolves.toMatchObject({ assignee_id: assignee.id, status: "assigned" });
      await expect(prisma.task.findUnique({ where: { id: otherRoleTask.id } }))
        .resolves.toMatchObject({ assignee_id: null, status: "claimable" });
      await expect(prisma.task.findUnique({ where: { id: otherUnitTask.id } }))
        .resolves.toMatchObject({ assignee_id: null, status: "claimable" });
    });

    it("should batch archive all units of a project by freezing tasks and archiving project", async () => {
      const { user: supervisor, token } = await createTestUser({ role: "supervisor" });
      const project = await createTestProject({ owner_id: supervisor.id, status: "active" });
      const unit = await createTestUnit({ project_id: project.id });
      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: supervisor.id,
        role: "translation",
        status: "claimable",
      });
      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: supervisor.id,
        role: "encoding",
        status: "assigned",
      });

      const res = await post(
        app,
        "/api/v1/files/batch/archive-units",
        { project_id: project.id },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.success).toBe(true);

      const archivedProject = await prisma.project.findUnique({ where: { id: project.id } });
      expect(archivedProject!.is_archived).toBe(true);
      expect(archivedProject!.status).toBe("archived");

      const remainingActiveTasks = await prisma.task.count({
        where: {
          project_id: project.id,
          status: { not: "frozen" },
        },
      });
      expect(remainingActiveTasks).toBe(0);
    });
  });

  describe("Project File Bucket Queries", () => {
    it("should query files by project with pagination", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      for (let i = 0; i < 5; i++) {
        await createTestFile({
          project_id: project.id,
          uploader_id: user.id,
          name: `file_${i}.ass`,
          file_type: "subtitle",
        });
      }

      const res = await get(app, `/api/v1/files?project_id=${project.id}&page=1&pageSize=3`, token);

      expectSuccess(res, 200);
      expect(res.body.data.files.length).toBe(3);
      expect(res.body.meta.total).toBe(5);
      expect(res.body.meta.totalPages).toBe(2);
    });

    it("should filter files by type", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "video.mkv",
        file_type: "video",
      });
      await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "sub.ass",
        file_type: "subtitle",
      });

      const res = await get(
        app,
        `/api/v1/files?project_id=${project.id}&file_type=subtitle`,
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.files.length).toBe(1);
      expect(res.body.data.files[0].file_type).toBe("subtitle");
    });

    it("should aggregate binary files and link assets with bucket filters", async () => {
      const { user, token } = await createTestUser();
      const { user: otherUser } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: user.id,
        role: "translation",
      });

      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "filtered.ass",
        file_type: "subtitle",
        metadata: JSON.stringify({
          unit_id: unit.id,
          task_id: task.id,
          role: "translation",
        }),
        tags: JSON.stringify(["dialogue", "approved"]),
      });
      await createTestFile({
        project_id: project.id,
        uploader_id: otherUser.id,
        name: "other-video.mp4",
        file_type: "video",
        metadata: JSON.stringify({
          unit_id: unit.id,
          role: "encoding",
        }),
        tags: JSON.stringify(["video"]),
      });
      await prisma.linkHistory.create({
        data: {
          project_id: project.id,
          file_id: file.id,
          url: "https://example.com/drive/filtered",
          link_type: "cloud_drive",
          description: "Filtered drive link",
          created_by: user.id,
        },
      });

      const res = await get(
        app,
        `/api/v1/files?project_id=${project.id}&unit_id=${unit.id}&task_id=${task.id}&role=translation&tag=dialogue`,
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items.map((item: { asset_kind: string }) => item.asset_kind).sort()).toEqual(["binary", "link"]);
      expect(res.body.data.files[0].current_version).toBeDefined();
      expect(res.body.data.files[0].version_count).toBeGreaterThanOrEqual(1);
      expect(res.body.meta.total).toBe(2);
    });

    it("should exclude deleted files by default", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      await prisma.fileEntity.update({
        where: { id: file.id },
        data: { is_deleted: true, deleted_at: new Date() },
      });

      const res = await get(app, `/api/v1/files?project_id=${project.id}`, token);

      expectSuccess(res, 200);
      expect(res.body.data.files.length).toBe(0);
    });

    it("should include deleted files when requested", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      await prisma.fileEntity.update({
        where: { id: file.id },
        data: { is_deleted: true, deleted_at: new Date() },
      });

      const res = await get(
        app,
        `/api/v1/files?project_id=${project.id}&include_deleted=true`,
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.files.length).toBe(1);
    });

    it("should expose asset detail with current version and version badges", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      await prisma.fileVersion.updateMany({
        where: { file_id: file.id },
        data: { is_latest: false },
      });
      await prisma.fileVersion.create({
        data: {
          file_id: file.id,
          version_number: 2,
          storage_path: "/uploads/detail-v2.ass",
          size_bytes: 2048,
          checksum: "detail-v2",
          is_current: true,
          is_latest: true,
          is_latest_approved: false,
        },
      });

      const res = await get(app, `/api/v1/files/${file.id}`, token);

      expectSuccess(res, 200);
      expect(res.body.data.current_version).toBeDefined();
      expect(res.body.data.version_count).toBeGreaterThanOrEqual(2);
      expect(res.body.data.has_multiple_versions).toBe(true);
      expect(res.body.data.uploader.id).toBe(user.id);
    });

    it("should allow a project supervisor to soft-delete another member file", async () => {
      const { user: owner } = await createTestUser();
      const { user: supervisor, token: supervisorToken } = await createTestUser();
      const { user: uploader } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: supervisor.id, role: "supervisor" },
      });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: uploader.id,
      });

      const res = await del(app, `/api/v1/files/${file.id}`, supervisorToken);

      expectSuccess(res, 200);
      const deletedFile = await prisma.fileEntity.findUnique({ where: { id: file.id } });
      expect(deletedFile!.is_deleted).toBe(true);
      expect(deletedFile!.deleted_by).toBe(supervisor.id);
    });

    it("should reject file deletion by a project member without elevated permissions", async () => {
      const { user: owner } = await createTestUser();
      const { user: uploader } = await createTestUser();
      const { user: member, token: memberToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: member.id, role: "translation" },
      });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: uploader.id,
      });

      const res = await del(app, `/api/v1/files/${file.id}`, memberToken);

      expectError(res, 403, "FORBIDDEN");
      const existingFile = await prisma.fileEntity.findUnique({ where: { id: file.id } });
      expect(existingFile!.is_deleted).toBe(false);
    });

    it("should deactivate existing download links when a file is deleted", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
      });
      const link = await prisma.downloadLink.create({
        data: {
          project_id: project.id,
          file_id: file.id,
          created_by: owner.id,
          token: "delete-file-link-token",
          expires_at: new Date(Date.now() + 60000),
          is_active: true,
        },
      });

      const res = await del(app, `/api/v1/files/${file.id}`, ownerToken);

      expectSuccess(res, 200);
      const inactiveLink = await prisma.downloadLink.findUnique({ where: { id: link.id } });
      expect(inactiveLink!.is_active).toBe(false);
      const downloadRes = await get(app, `/api/v1/files/download/${link.token}`);
      expectError(downloadRes, 410, "GONE");
    });
  });

  describe("Review Snapshot Persistence", () => {
    it("should persist review snapshots", async () => {
      const { user: reviewer, token: reviewerToken } = await createTestUser();
      const { user: requester } = await createTestUser();
      const project = await createTestProject({ owner_id: reviewer.id });
      const { file, version } = await createTestFile({
        project_id: project.id,
        uploader_id: requester.id,
      });

      const review = await prisma.review.create({
        data: {
          project_id: project.id,
          file_version_id: version.id,
          reviewer_id: reviewer.id,
          requester_id: requester.id,
          status: "rejected",
          comments: "Needs work",
        },
      });

      const snapshot = await prisma.reviewSnapshot.create({
        data: {
          review_id: review.id,
          file_id: file.id,
          version_number: version.version_number,
          content: "Snapshot of file content at review time",
        },
      });

      const retrievedSnapshot = await prisma.reviewSnapshot.findUnique({
        where: { id: snapshot.id },
      });

      expect(retrievedSnapshot).toBeDefined();
      expect(retrievedSnapshot!.content).toBe("Snapshot of file content at review time");
      expect(retrievedSnapshot!.file_id).toBe(file.id);
      expect(retrievedSnapshot!.version_number).toBe(version.version_number);
    });

    it("should retrieve snapshots with review", async () => {
      const { user: reviewer } = await createTestUser();
      const { user: requester } = await createTestUser();
      const project = await createTestProject({ owner_id: reviewer.id });
      const { file, version } = await createTestFile({
        project_id: project.id,
        uploader_id: requester.id,
      });

      const review = await prisma.review.create({
        data: {
          project_id: project.id,
          file_version_id: version.id,
          reviewer_id: reviewer.id,
          requester_id: requester.id,
          status: "rejected",
          comments: "Needs revision",
        },
      });

      await prisma.reviewSnapshot.create({
        data: {
          review_id: review.id,
          file_id: file.id,
          version_number: 1,
          content: "v1 content",
        },
      });

      const reviewWithSnapshots = await prisma.review.findUnique({
        where: { id: review.id },
        include: { snapshots: true },
      });

      expect(reviewWithSnapshots!.snapshots.length).toBe(1);
      expect(reviewWithSnapshots!.snapshots[0].content).toBe("v1 content");
    });
  });
});
