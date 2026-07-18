import type { Application } from "express";
import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestFile,
  createTestUnit,
  createTestTask,
  createTestTemplate,
  cleanDatabase,
} from "./setup";
import { post, expectError, expectSuccess } from "./helpers";

describe("Security Wave 7 - File Upload/Replace IDOR", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp({ databaseReady: true });
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  const baseUploadPayload = (projectId: string) => ({
    project_id: projectId,
    name: "idor-test.ass",
    file_type: "subtitle",
    mime_type: "application/x-ass",
    size_bytes: 1024,
    storage_path: "/uploads/idor-test.ass",
  });

  it("rejects upload by non-member without any role tag", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const project = await createTestProject({ owner_id: owner.user.id });

    const res = await post(
      app,
      "/api/v1/files/upload",
      baseUploadPayload(project.id),
      outsider.token
    );

    expectError(res, 403, "FORBIDDEN");
  });

  it("rejects upload by non-member even when body explicitly sends role=translation", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const project = await createTestProject({ owner_id: owner.user.id });

    const res = await post(
      app,
      "/api/v1/files/upload",
      {
        ...baseUploadPayload(project.id),
        role: "translation",
      },
      outsider.token
    );

    expectError(res, 403, "FORBIDDEN");
  });

  it("rejects upload by pure open-claim candidate holding an approved translation tag", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const template = await createTestTemplate();
    const project = await createTestProject({
      owner_id: owner.user.id,
      template_id: template.id,
    });
    const unit = await createTestUnit({ project_id: project.id });
    await createTestTask({
      project_id: project.id,
      unit_id: unit.id,
      creator_id: owner.user.id,
      role: "translation",
      status: "claimable",
    });

    const tag = await prisma.roleTag.create({
      data: {
        name: `translation_${Math.random().toString(36).substring(2, 10)}`,
        role_type: "translation",
      },
    });
    await prisma.tagApplication.create({
      data: {
        user_id: outsider.user.id,
        tag_id: tag.id,
        approved: true,
        approved_by: owner.user.id,
        approved_at: new Date(),
      },
    });

    const res = await post(
      app,
      "/api/v1/files/upload",
      {
        ...baseUploadPayload(project.id),
        role: "translation",
      },
      outsider.token
    );

    expectError(res, 403, "FORBIDDEN");
  });

  it("allows project member to upload normally", async () => {
    const owner = await createTestUser();
    const project = await createTestProject({ owner_id: owner.user.id });

    const res = await post(
      app,
      "/api/v1/files/upload",
      baseUploadPayload(project.id),
      owner.token
    );

    expectSuccess(res, 201);
  });

  it("rejects replace by non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const project = await createTestProject({ owner_id: owner.user.id });
    const { file } = await createTestFile({
      project_id: project.id,
      uploader_id: owner.user.id,
    });

    const res = await post(
      app,
      `/api/v1/files/projects/${project.id}/files/${file.id}/replace`,
      {
        name: "replaced.ass",
        mime_type: "application/x-ass",
        size_bytes: 2048,
        storage_path: "/uploads/replaced.ass",
      },
      outsider.token
    );

    expectError(res, 403, "FORBIDDEN");
  });
});
