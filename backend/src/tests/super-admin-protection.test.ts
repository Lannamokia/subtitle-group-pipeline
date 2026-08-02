import { createApp } from "../app";
import { prisma, createTestUser, cleanDatabase } from "./setup";
import { post, put, expectSuccess, expectError } from "./helpers";
import type { Application } from "express";

/**
 * 回归测试：组管理员不得改动超级管理员账号。
 *
 * 背景：曾出现「组管理员能够修改超级管理员的权限」的问题。
 * 角色端点后来补了守卫，但标签授予/重置、通过验证这几条路径长期没有同样的检查，
 * 而权限标签本身就决定成员能认领哪些岗位，等同于权限改动。
 */
describe("Super admin account protection", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp({ databaseReady: true });
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanDatabase();
  });

  async function createRoleTag(name = "翻译组") {
    return prisma.roleTag.create({
      data: {
        name: `${name}_${Math.random().toString(36).slice(2, 8)}`,
        role_type: "translation",
      },
    });
  }

  describe("组管理员对超级管理员", () => {
    it("不能修改超级管理员的系统角色", async () => {
      const { user: superAdmin } = await createTestUser({ role: "super_admin" });
      const { token: groupAdminToken } = await createTestUser({ role: "group_admin" });

      const res = await put(
        app,
        `/api/v1/auth/members/${superAdmin.id}/role`,
        { role: "member" },
        groupAdminToken
      );

      expectError(res, 403, "FORBIDDEN");

      const after = await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } });
      expect(after.role).toBe("super_admin");
    });

    it("不能把自己或他人提升为超级管理员", async () => {
      await createTestUser({ role: "super_admin" });
      const { user: groupAdmin, token: groupAdminToken } = await createTestUser({
        role: "group_admin",
      });

      const res = await put(
        app,
        `/api/v1/auth/members/${groupAdmin.id}/role`,
        { role: "super_admin" },
        groupAdminToken
      );

      expectError(res, 403, "FORBIDDEN");

      const after = await prisma.user.findUniqueOrThrow({ where: { id: groupAdmin.id } });
      expect(after.role).toBe("group_admin");
    });

    it("不能给超级管理员授予岗位标签", async () => {
      const { user: superAdmin } = await createTestUser({ role: "super_admin" });
      const { token: groupAdminToken } = await createTestUser({ role: "group_admin" });
      const tag = await createRoleTag();

      const res = await post(
        app,
        `/api/v1/auth/members/${superAdmin.id}/tags/grant`,
        { tagIds: [tag.id] },
        groupAdminToken
      );

      expectError(res, 403, "FORBIDDEN");

      const granted = await prisma.tagApplication.count({
        where: { user_id: superAdmin.id, tag_id: tag.id },
      });
      expect(granted).toBe(0);
    });

    it("不能重置超级管理员的岗位标签", async () => {
      const { user: superAdmin } = await createTestUser({ role: "super_admin" });
      const { token: groupAdminToken } = await createTestUser({ role: "group_admin" });
      const tag = await createRoleTag();

      await prisma.tagApplication.create({
        data: {
          user_id: superAdmin.id,
          tag_id: tag.id,
          reason: "seed",
          approved: true,
          approved_at: new Date(),
        },
      });

      const res = await post(
        app,
        `/api/v1/auth/members/${superAdmin.id}/tags/reset`,
        { tagIds: [tag.id] },
        groupAdminToken
      );

      expectError(res, 403, "FORBIDDEN");

      const stillThere = await prisma.tagApplication.count({
        where: { user_id: superAdmin.id, tag_id: tag.id },
      });
      expect(stillThere).toBe(1);
    });

    it("不能禁用超级管理员", async () => {
      const { user: superAdmin } = await createTestUser({ role: "super_admin" });
      const { token: groupAdminToken } = await createTestUser({ role: "group_admin" });

      const res = await put(
        app,
        `/api/v1/auth/members/${superAdmin.id}/status`,
        { status: "disabled" },
        groupAdminToken
      );

      expectError(res, 403, "FORBIDDEN");

      const after = await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } });
      expect(after.status).toBe("active");
    });

    it("不能重置超级管理员的密码", async () => {
      const { user: superAdmin } = await createTestUser({ role: "super_admin" });
      const { token: groupAdminToken } = await createTestUser({ role: "group_admin" });

      const before = await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } });

      const res = await put(
        app,
        `/api/v1/auth/members/${superAdmin.id}/password`,
        { password: "HijackedPassword123!" },
        groupAdminToken
      );

      expectError(res, 403, "FORBIDDEN");

      const after = await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } });
      expect(after.password_hash).toBe(before.password_hash);
    });

    it("不能通过「通过验证」激活待验证的超级管理员", async () => {
      const { user: superAdmin } = await createTestUser({
        role: "super_admin",
        status: "pending_verification",
      });
      const { token: groupAdminToken } = await createTestUser({ role: "group_admin" });

      const res = await post(
        app,
        `/api/v1/auth/members/${superAdmin.id}/verify`,
        {},
        groupAdminToken
      );

      expectError(res, 403, "FORBIDDEN");

      const after = await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } });
      expect(after.status).toBe("pending_verification");
    });
  });

  describe("超级管理员自己仍可正常管理", () => {
    it("可以给普通成员授予标签", async () => {
      const { token: superAdminToken } = await createTestUser({ role: "super_admin" });
      const { user: member } = await createTestUser({ role: "member" });
      const tag = await createRoleTag();

      const res = await post(
        app,
        `/api/v1/auth/members/${member.id}/tags/grant`,
        { tagIds: [tag.id] },
        superAdminToken
      );

      expectSuccess(res);

      const granted = await prisma.tagApplication.count({
        where: { user_id: member.id, tag_id: tag.id, approved: true },
      });
      expect(granted).toBe(1);
    });

    it("组管理员仍可管理普通成员的角色", async () => {
      const { token: groupAdminToken } = await createTestUser({ role: "group_admin" });
      const { user: member } = await createTestUser({ role: "member" });

      const res = await put(
        app,
        `/api/v1/auth/members/${member.id}/role`,
        { role: "supervisor" },
        groupAdminToken
      );

      expectSuccess(res);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(after.role).toBe("supervisor");
    });
  });
});
