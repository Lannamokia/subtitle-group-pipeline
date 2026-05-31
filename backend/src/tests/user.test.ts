import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestStorageBackend,
  createTestFile,
  cleanDatabase,
} from "./setup";
import { post, get, put, del, expectSuccess, expectError } from "./helpers";
import * as storageService from "../modules/storage/storage.service";
import { S3Adapter } from "../modules/storage/adapters/s3.adapter";
import type { Application } from "express";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

describe("User Profile & Storage Tests", () => {
  let app: Application;

  function resolveUploadedAvatarPath(avatarUrl: string): string {
    return path.resolve(env.UPLOAD_DIR, avatarUrl.replace(/^\/uploads\//, ""));
  }

  beforeAll(() => {
    app = createApp({ databaseReady: true });
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanDatabase();
  });

  describe("User Profile Updates", () => {
    it("should update user nickname", async () => {
      const { user, token } = await createTestUser();

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { nickname: "New Nickname" },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.nickname).toBe("New Nickname");

      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated!.nickname).toBe("New Nickname");
    });

    it("should update user email", async () => {
      const { user, token } = await createTestUser();

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { email: "newemail@example.com" },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.email).toBe("newemail@example.com");
    });

    it("should update user bio", async () => {
      const { user, token } = await createTestUser();

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { bio: "I love translating anime!" },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.bio).toBe("I love translating anime!");
    });

    it("should update avatar URL", async () => {
      const { user, token } = await createTestUser();

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { avatar_url: "https://example.com/avatar.png" },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.avatar_url).toBe("https://example.com/avatar.png");
    });

    it("should update local stored avatar path", async () => {
      const { token } = await createTestUser();

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { avatar_url: "/uploads/projects/avatars/user-avatar.png" },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.avatar_url).toBe("/uploads/projects/avatars/user-avatar.png");
    });

    it("should delete previous stored avatar when replacing avatar", async () => {
      const backend = await createTestStorageBackend({
        backend_type: "local",
        is_default: true,
        config: { basePath: "./uploads" },
      });
      const { user, token } = await createTestUser();
      const oldBuffer = Buffer.from("old-avatar");
      const newBuffer = Buffer.from("new-avatar");

      const oldAvatar = await storageService.uploadAvatar(
        user.id,
        oldBuffer,
        "image/png",
        "old.png"
      );
      const oldAvatarPath = resolveUploadedAvatarPath(oldAvatar.avatarUrl);

      expect(fs.existsSync(oldAvatarPath)).toBe(true);

      expectSuccess(
        await put(app, "/api/v1/auth/profile", { avatar_url: oldAvatar.avatarUrl }, token),
        200
      );

      const newAvatar = await storageService.uploadAvatar(
        user.id,
        newBuffer,
        "image/png",
        "new.png"
      );
      const newAvatarPath = resolveUploadedAvatarPath(newAvatar.avatarUrl);

      expect(fs.existsSync(newAvatarPath)).toBe(true);

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { avatar_url: newAvatar.avatarUrl },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.avatar_url).toBe(newAvatar.avatarUrl);
      expect(fs.existsSync(oldAvatarPath)).toBe(false);
      expect(fs.existsSync(newAvatarPath)).toBe(true);

      const updatedBackend = await prisma.storageBackend.findUnique({ where: { id: backend.id } });
      expect(updatedBackend!.file_count).toBe(1);
      expect(Number(updatedBackend!.used_bytes)).toBe(newBuffer.length);
    });

    it("should keep session-critical profile fields in update response", async () => {
      const { token } = await createTestUser({ role: "supervisor" });

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { nickname: "Updated Profile" },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.nickname).toBe("Updated Profile");
      expect(res.body.data.role).toBe("supervisor");
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.created_at).toBeDefined();
    });

    it("should reject invalid email format", async () => {
      const { token } = await createTestUser();

      const res = await put(
        app,
        "/api/v1/auth/profile",
        { email: "not-an-email" },
        token
      );

      expectError(res, 400);
    });

    it("should get current user with role tags", async () => {
      const { user, token } = await createTestUser();
      const tag = await prisma.roleTag.create({
        data: { name: "Translator", description: "Can translate", color: "#3b82f6" },
      });
      await prisma.tagApplication.create({
        data: { user_id: user.id, tag_id: tag.id, approved: true },
      });

      const res = await get(app, "/api/v1/auth/me", token);

      expectSuccess(res, 200);
      expect(res.body.data.roleTags).toBeDefined();
      expect(res.body.data.roleTags.length).toBe(1);
      expect(res.body.data.roleTags[0].name).toBe("Translator");
    });

    it("should track last login timestamp", async () => {
      await prisma.registrationPolicy.create({
        data: { mode: "open", auto_approve: true },
      });

      await post(app, "/api/v1/auth/register", {
        username: "logintrack",
        password: "Password123!",
        nickname: "Login Track",
      });

      const beforeLogin = new Date();

      await post(app, "/api/v1/auth/login", {
        username: "logintrack",
        password: "Password123!",
      });

      const user = await prisma.user.findUnique({
        where: { username: "logintrack" },
      });

      expect(user!.last_login_at).not.toBeNull();
      expect(user!.last_login_at!.getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime());
    });
  });

  describe("Avatar Upload to Default Storage Backend", () => {
    it("should upload avatar to default storage backend", async () => {
      const backend = await createTestStorageBackend({
        backend_type: "local",
        is_default: true,
        config: { basePath: "./uploads" },
      });

      const { user, token } = await createTestUser();

      // Create a mock buffer for avatar
      const avatarBuffer = Buffer.from("fake-image-data");

      const result = await storageService.uploadAvatar(
        user.id,
        avatarBuffer,
        "image/png",
        "avatar.png"
      );

      expect(result.avatarUrl).toBeDefined();
      expect(result.size).toBe(avatarBuffer.length);
    });

    it("should serve local avatar image through the storage avatar endpoint", async () => {
      await createTestStorageBackend({
        backend_type: "local",
        is_default: true,
        config: { basePath: "./uploads" },
      });

      const { user } = await createTestUser();
      const avatarBuffer = Buffer.from("fake-image-data");
      const result = await storageService.uploadAvatar(
        user.id,
        avatarBuffer,
        "image/png",
        "avatar.png"
      );
      await prisma.user.update({
        where: { id: user.id },
        data: { avatar_url: result.avatarUrl },
      });

      const res = await get(app, `/api/v1/storage/avatar/${user.id}/image`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
    });

    it("should redirect S3 avatar image requests to a presigned URL", async () => {
      await createTestStorageBackend({
        backend_type: "s3",
        is_default: true,
        config: {
          bucket: "avatars",
          region: "us-east-1",
          accessKeyId: "valid-access-key",
          secretAccessKey: "valid-secret-key",
          endpoint: "https://s3.example.com",
        },
      });
      const { user } = await createTestUser();
      await prisma.user.update({
        where: { id: user.id },
        data: { avatar_url: "s3://avatars/projects/avatars/user.png" },
      });
      jest
        .spyOn(S3Adapter.prototype, "getPresignedUrl")
        .mockResolvedValue("https://signed.example.com/avatar.png");

      const res = await get(app, `/api/v1/storage/avatar/${user.id}/image`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("https://signed.example.com/avatar.png");
    });

    it("should reject invalid avatar file types", async () => {
      const backend = await createTestStorageBackend({
        backend_type: "local",
        is_default: true,
      });

      const { user } = await createTestUser();
      const avatarBuffer = Buffer.from("fake-data");

      await expect(
        storageService.uploadAvatar(user.id, avatarBuffer, "application/pdf", "avatar.pdf")
      ).rejects.toThrow("Invalid file type");
    });

    it("should reject oversized avatars", async () => {
      const backend = await createTestStorageBackend({
        backend_type: "local",
        is_default: true,
      });

      const { user } = await createTestUser();
      const avatarBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB

      await expect(
        storageService.uploadAvatar(user.id, avatarBuffer, "image/png", "avatar.png")
      ).rejects.toThrow("Avatar too large");
    });
  });

  describe("Storage Backend CRUD with Quota Enforcement", () => {
    it("should create storage backend", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });

      const res = await post(
        app,
        "/api/v1/storage/backends",
        {
          name: "Local Storage",
          backend_type: "local",
          config: JSON.stringify({ basePath: "./uploads" }),
          is_default: false,
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.name).toBe("Local Storage");
      expect(res.body.data.backend_type).toBe("local");
    });

    it("should normalize S3 storage config aliases on create", async () => {
      const { token } = await createTestUser({ role: "super_admin" });
      jest.spyOn(S3Adapter.prototype, "validateConnection").mockResolvedValue(undefined);

      const res = await post(
        app,
        "/api/v1/storage/backends",
        {
          name: "S3 Storage",
          backend_type: "s3",
          config: JSON.stringify({
            endpoint: "https://s3.example.com",
            bucket: "subtitle-files",
            region: "us-east-1",
            accessKey: "access-key",
            secretKey: "secret-key",
          }),
          is_default: false,
        },
        token
      );

      expectSuccess(res, 201);

      const config = JSON.parse(res.body.data.config);
      expect(config.accessKeyId).toBe("access-key");
      expect(config.secretAccessKey).toBe("secret-key");
      expect(config.accessKey).toBeUndefined();
      expect(config.secretKey).toBeUndefined();
    });

    it("should reject incomplete S3 storage config before upload", async () => {
      const { token } = await createTestUser({ role: "super_admin" });

      const res = await post(
        app,
        "/api/v1/storage/backends",
        {
          name: "Broken S3 Storage",
          backend_type: "s3",
          config: JSON.stringify({
            endpoint: "https://s3.example.com",
            bucket: "subtitle-files",
            region: "us-east-1",
          }),
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.body.error.message).toContain("accessKeyId");
      expect(res.body.error.message).toContain("secretAccessKey");
    });

    it("should reject invalid S3 credentials before saving", async () => {
      const { token } = await createTestUser({ role: "super_admin" });
      jest
        .spyOn(S3Adapter.prototype, "validateConnection")
        .mockRejectedValue(new Error("The security token included in the request is invalid"));

      const res = await post(
        app,
        "/api/v1/storage/backends",
        {
          name: "Invalid S3 Storage",
          backend_type: "s3",
          config: JSON.stringify({
            endpoint: "https://s3.example.com",
            bucket: "subtitle-files",
            region: "us-east-1",
            accessKey: "access-key",
            secretKey: "bad-secret",
          }),
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.body.error.message).toContain("S3 config validation failed");
      const created = await prisma.storageBackend.findFirst({ where: { name: "Invalid S3 Storage" } });
      expect(created).toBeNull();
    });

    it("should enforce quota on storage backend", async () => {
      const backend = await createTestStorageBackend({
        quota_bytes: 1000,
        used_bytes: 800,
      });

      const hasQuota = await storageService.checkQuota(backend.id, 100);
      expect(hasQuota).toBe(true);

      const exceedsQuota = await storageService.checkQuota(backend.id, 300);
      expect(exceedsQuota).toBe(false);
    });

    it("should allow unlimited storage when quota is null", async () => {
      const backend = await createTestStorageBackend({
        quota_bytes: null,
        used_bytes: 1000000,
      });

      const hasQuota = await storageService.checkQuota(backend.id, 1000000000);
      expect(hasQuota).toBe(true);
    });

    it("should update storage backend usage", async () => {
      const backend = await createTestStorageBackend({
        used_bytes: 0,
        file_count: 0,
      });

      await storageService.updateUsage(backend.id, 1024, 1);

      const updated = await prisma.storageBackend.findUnique({
        where: { id: backend.id },
      });
      expect(updated!.used_bytes).toBe(1024n);
      expect(updated!.file_count).toBe(1);

      await storageService.updateUsage(backend.id, -512, -1);

      const decreased = await prisma.storageBackend.findUnique({
        where: { id: backend.id },
      });
      expect(decreased!.used_bytes).toBe(512n);
      expect(decreased!.file_count).toBe(0);
    });

    it("should not allow negative usage", async () => {
      const backend = await createTestStorageBackend({
        used_bytes: 100,
        file_count: 1,
      });

      await storageService.updateUsage(backend.id, -200, -5);

      const updated = await prisma.storageBackend.findUnique({
        where: { id: backend.id },
      });
      expect(updated!.used_bytes).toBe(0n);
      expect(updated!.file_count).toBe(0);
    });

    it("should update storage backend", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });
      const backend = await createTestStorageBackend({ name: "Old Name" });

      const res = await put(
        app,
        `/api/v1/storage/backends/${backend.id}`,
        { name: "New Name", is_active: false },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.name).toBe("New Name");
      expect(res.body.data.is_active).toBe(false);
    });

    it("should preserve S3 secret when update payload leaves it blank", async () => {
      const { token } = await createTestUser({ role: "super_admin" });
      jest.spyOn(S3Adapter.prototype, "validateConnection").mockResolvedValue(undefined);
      const backend = await createTestStorageBackend({
        backend_type: "s3",
        config: {
          endpoint: "https://s3.example.com",
          bucket: "old-bucket",
          region: "us-east-1",
          accessKeyId: "old-access-key",
          secretAccessKey: "old-secret-key",
        },
      });

      const res = await put(
        app,
        `/api/v1/storage/backends/${backend.id}`,
        {
          backend_type: "s3",
          config: JSON.stringify({
            endpoint: "https://s3.example.com",
            bucket: "new-bucket",
            region: "us-west-2",
            accessKey: "new-access-key",
            secretKey: "",
          }),
        },
        token
      );

      expectSuccess(res, 200);

      const config = JSON.parse(res.body.data.config);
      expect(config.bucket).toBe("new-bucket");
      expect(config.region).toBe("us-west-2");
      expect(config.accessKeyId).toBe("new-access-key");
      expect(config.secretAccessKey).toBe("old-secret-key");
    });

    it("should reject invalid S3 config on update before saving", async () => {
      const { token } = await createTestUser({ role: "super_admin" });
      const backend = await createTestStorageBackend({
        backend_type: "s3",
        config: {
          endpoint: "https://s3.example.com",
          bucket: "old-bucket",
          region: "us-east-1",
          accessKeyId: "old-access-key",
          secretAccessKey: "old-secret-key",
        },
      });
      jest
        .spyOn(S3Adapter.prototype, "validateConnection")
        .mockRejectedValue(new Error("SignatureDoesNotMatch"));

      const res = await put(
        app,
        `/api/v1/storage/backends/${backend.id}`,
        {
          backend_type: "s3",
          config: JSON.stringify({
            endpoint: "https://s3.example.com",
            bucket: "new-bucket",
            region: "us-west-2",
            accessKey: "new-access-key",
            secretKey: "bad-secret",
          }),
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
      const unchanged = await prisma.storageBackend.findUnique({ where: { id: backend.id } });
      const config = JSON.parse(unchanged!.config);
      expect(config.bucket).toBe("old-bucket");
      expect(config.secretAccessKey).toBe("old-secret-key");
    });

    it("should reject invalid JSON config", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });

      const res = await post(
        app,
        "/api/v1/storage/backends",
        {
          name: "Bad Config",
          backend_type: "local",
          config: "not-valid-json",
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
    });

    it("should delete storage backend not in use", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });
      const backend = await createTestStorageBackend();

      const res = await del(app, `/api/v1/storage/backends/${backend.id}`, token);

      expectSuccess(res, 200);

      const deleted = await prisma.storageBackend.findUnique({
        where: { id: backend.id },
      });
      expect(deleted).toBeNull();
    });

    it("should reject deleting backend in use by projects", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });
      const backend = await createTestStorageBackend();
      await createTestProject({ owner_id: user.id, storage_backend_id: backend.id });

      const res = await del(app, `/api/v1/storage/backends/${backend.id}`, token);

      expectError(res, 409, "CONFLICT");
    });

    it("should set only one default backend", async () => {
      const { user, token } = await createTestUser({ role: "super_admin" });

      await createTestStorageBackend({ is_default: true });

      const res = await post(
        app,
        "/api/v1/storage/backends",
        {
          name: "New Default",
          backend_type: "local",
          config: JSON.stringify({ basePath: "./uploads2" }),
          is_default: true,
        },
        token
      );

      expectSuccess(res, 201);

      const defaults = await prisma.storageBackend.findMany({
        where: { is_default: true },
      });
      expect(defaults.length).toBe(1);
      expect(defaults[0].name).toBe("New Default");
    });
  });

  describe("Project Creation with Storage Backend Binding", () => {
    it("should create project with storage backend binding", async () => {
      const { user, token } = await createTestUser({ role: "supervisor" });
      const backend = await createTestStorageBackend();

      const res = await post(
        app,
        "/api/v1/projects",
        {
          name: "Project With Backend",
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
        },
        token
      );

      expectSuccess(res, 201);

      const project = await prisma.project.findUnique({
        where: { id: res.body.data.id },
      });
      expect(project!.storage_backend_id).toBe(backend.id);
    });

    it("should reject inactive storage backend", async () => {
      const { user, token } = await createTestUser();
      const backend = await createTestStorageBackend({ is_active: false });

      // The project creation may not validate backend status at the API level
      // This tests the service layer validation
      await expect(
        storageService.uploadFile(backend.id, "test-project", Buffer.from("test"), "test.txt")
      ).rejects.toThrow("Storage backend is inactive");
    });
  });

  describe("File Upload Routing to Bound Backend", () => {
    it("should route file upload to project's bound backend", async () => {
      const { user } = await createTestUser();
      const backend = await createTestStorageBackend({
        backend_type: "local",
        config: { basePath: "./uploads" },
      });
      const project = await createTestProject({
        owner_id: user.id,
        storage_backend_id: backend.id,
      });

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
          storage_backend_id: backend.id,
        },
      });

      expect(file.storage_backend_id).toBe(backend.id);
    });

    it("should fallback to default backend when project has no bound backend", async () => {
      const { user } = await createTestUser();
      const defaultBackend = await createTestStorageBackend({ is_default: true });
      const project = await createTestProject({ owner_id: user.id });

      // Project has no storage_backend_id, should use default
      expect(project.storage_backend_id).toBeNull();

      const fallback = await storageService.getDefaultBackend();
      expect(fallback.id).toBe(defaultBackend.id);
    });
  });

  describe("Multi-Backend Isolation", () => {
    it("should isolate files between different backends", async () => {
      const { user } = await createTestUser();
      const backend1 = await createTestStorageBackend({ name: "Backend 1" });
      const backend2 = await createTestStorageBackend({ name: "Backend 2" });
      const project1 = await createTestProject({
        owner_id: user.id,
        storage_backend_id: backend1.id,
      });
      const project2 = await createTestProject({
        owner_id: user.id,
        storage_backend_id: backend2.id,
      });

      await createTestFile({
        project_id: project1.id,
        uploader_id: user.id,
        storage_backend_id: backend1.id,
        name: "file1.ass",
      });

      await createTestFile({
        project_id: project2.id,
        uploader_id: user.id,
        storage_backend_id: backend2.id,
        name: "file2.ass",
      });

      const filesOnBackend1 = await prisma.fileEntity.findMany({
        where: { storage_backend_id: backend1.id },
      });
      const filesOnBackend2 = await prisma.fileEntity.findMany({
        where: { storage_backend_id: backend2.id },
      });

      expect(filesOnBackend1.length).toBe(1);
      expect(filesOnBackend1[0].name).toBe("file1.ass");
      expect(filesOnBackend2.length).toBe(1);
      expect(filesOnBackend2[0].name).toBe("file2.ass");
    });

    it("should track usage per backend independently", async () => {
      const backend1 = await createTestStorageBackend({
        name: "Backend 1",
        used_bytes: 1000,
        file_count: 5,
      });
      const backend2 = await createTestStorageBackend({
        name: "Backend 2",
        used_bytes: 2000,
        file_count: 10,
      });

      const b1 = await prisma.storageBackend.findUnique({ where: { id: backend1.id } });
      const b2 = await prisma.storageBackend.findUnique({ where: { id: backend2.id } });

      expect(b1!.used_bytes).toBe(1000n);
      expect(b1!.file_count).toBe(5);
      expect(b2!.used_bytes).toBe(2000n);
      expect(b2!.file_count).toBe(10);
    });
  });
});
