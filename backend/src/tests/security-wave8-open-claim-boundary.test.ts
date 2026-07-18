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
  createTestTranslationClaim,
  cleanDatabase,
} from "./setup";
import { get, post, del, expectError, expectSuccess } from "./helpers";

/**
 * Wave 8 regression tests for the open-claim read/write boundary.
 *
 * Design invariant: holding an approved role tag makes a user eligible to
 * *see* (and later claim) open tasks, but it must NEVER grant write access
 * to file operations, task management, or subtitle merge jobs.
 */
describe("Security Wave 8 - Open-Claim Read/Write Boundary", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp({ databaseReady: true });
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  const baseUploadPayload = (projectId: string) => ({
    project_id: projectId,
    name: "boundary-test.ass",
    file_type: "subtitle",
    mime_type: "application/x-ass",
    size_bytes: 1024,
    storage_path: "/uploads/boundary-test.ass",
  });

  /**
   * Creates a project with a single claimable task for role `timing`,
   * plus a candidate user who has been granted an approved tag for that role.
   * Returns the project, the claimable task, and the candidate's token.
   */
  async function createOpenClaimScenario() {
    const { user: owner, token: ownerToken } = await createTestUser();
    const { user: candidate, token: candidateToken } = await createTestUser();
    const { token: outsiderToken } = await createTestUser();

    const template = await createTestTemplate({
      roles: [
        { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "open_claim" },
        { role: "translation", enabled: true, slotCount: 2, assignmentStrategy: "open_claim" },
      ],
    });

    const project = await createTestProject({
      owner_id: owner.id,
      template_id: template.id,
    });
    const unit = await createTestUnit({ project_id: project.id });

    const tag = await prisma.roleTag.create({
      data: { name: "Timing Specialist", role_type: "timing" },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: {
        workflow_config: JSON.stringify([
          {
            role: "timing",
            enabled: true,
            assignmentStrategy: "open_claim",
            requiredTagIds: [tag.id],
          },
        ]),
      },
    });
    await prisma.tagApplication.create({
      data: {
        user_id: candidate.id,
        tag_id: tag.id,
        approved: true,
        approved_by: owner.id,
        approved_at: new Date(),
      },
    });

    const task = await createTestTask({
      project_id: project.id,
      unit_id: unit.id,
      role: "timing",
      status: "claimable",
      creator_id: owner.id,
    });

    return {
      owner,
      ownerToken,
      project,
      unit,
      task,
      tag,
      candidate,
      candidateToken,
      outsiderToken,
    };
  }

  describe("Read access (should be granted to open-claim candidates)", () => {
    it("GET /api/v1/projects/:id returns 200 for a matching candidate", async () => {
      const { project, candidateToken } = await createOpenClaimScenario();

      const res = await get(app, `/api/v1/projects/${project.id}`, candidateToken);
      expectSuccess(res, 200);
    });

    it("GET /api/v1/tasks?project_id=X returns 200 and includes the claimable task", async () => {
      const { project, task, candidateToken } = await createOpenClaimScenario();

      const res = await get(app, `/api/v1/tasks?project_id=${project.id}`, candidateToken);
      expectSuccess(res, 200);
      expect(res.body.data.some((item: { id: string }) => item.id === task.id)).toBe(true);
    });

    it("GET /api/v1/tasks/:id returns 200 for a matching candidate", async () => {
      const { task, candidateToken } = await createOpenClaimScenario();

      const res = await get(app, `/api/v1/tasks/${task.id}`, candidateToken);
      expectSuccess(res, 200);
    });
  });

  describe("Write access (must be rejected for open-claim candidates)", () => {
    it("POST /api/v1/files/upload is rejected for a candidate", async () => {
      const { project, candidateToken } = await createOpenClaimScenario();

      const res = await post(
        app,
        "/api/v1/files/upload",
        baseUploadPayload(project.id),
        candidateToken
      );
      expectError(res, 403, "FORBIDDEN");
    });

    it("POST /api/v1/files/projects/:projectId/files/:fileId/replace is rejected for a candidate", async () => {
      const { project, owner, candidateToken } = await createOpenClaimScenario();
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
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
        candidateToken
      );
      expectError(res, 403, "FORBIDDEN");
    });

    it("POST /api/v1/subtitles/units/:unitId/merge-jobs is rejected for a candidate", async () => {
      const { project, unit, owner, candidateToken } = await createOpenClaimScenario();
      const claimableTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });
      const { claim } = await createTestTranslationClaim({
        project_id: project.id,
        task_id: claimableTask.id,
        unit_id: unit.id,
        user_id: owner.id,
        status: "submitted",
      });

      const res = await post(
        app,
        `/api/v1/subtitles/units/${unit.id}/merge-jobs`,
        { claim_ids: [claim.id] },
        candidateToken
      );
      expectError(res, 403, "FORBIDDEN");
    });

    it("POST /api/v1/tasks is rejected for a candidate", async () => {
      const { project, unit, candidateToken } = await createOpenClaimScenario();

      const res = await post(
        app,
        "/api/v1/tasks",
        {
          project_id: project.id,
          unit_id: unit.id,
          title: "Candidate-created task",
          role: "timing",
        },
        candidateToken
      );
      expectError(res, 403, "FORBIDDEN");
    });

    it("POST /api/v1/files/:fileId/versions/:versionId/approve is rejected for a candidate", async () => {
      const { project, owner, candidateToken } = await createOpenClaimScenario();
      const { file, version } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
      });

      const res = await post(
        app,
        `/api/v1/files/${file.id}/versions/${version.id}/approve`,
        {},
        candidateToken
      );
      expectError(res, 403, "FORBIDDEN");
    });

    it("DELETE /api/v1/tasks/:id is rejected for a candidate", async () => {
      const { task, candidateToken } = await createOpenClaimScenario();

      const res = await del(app, `/api/v1/tasks/${task.id}`, candidateToken);
      expectError(res, 403, "FORBIDDEN");
    });
  });

  describe("Control group: project member can still perform write operations", () => {
    it("POST /api/v1/files/upload succeeds for a project member", async () => {
      const { project, ownerToken } = await createOpenClaimScenario();

      const res = await post(
        app,
        "/api/v1/files/upload",
        baseUploadPayload(project.id),
        ownerToken
      );
      expectSuccess(res, 201);
    });

    it("POST /api/v1/files/projects/:projectId/files/:fileId/replace succeeds for a project member", async () => {
      const { project, owner, ownerToken } = await createOpenClaimScenario();
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
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
        ownerToken
      );
      expectSuccess(res, 200);
    });

    it("POST /api/v1/subtitles/units/:unitId/merge-jobs succeeds for a project member", async () => {
      const { project, unit, owner, ownerToken } = await createOpenClaimScenario();
      const claimableTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });
      const { claim } = await createTestTranslationClaim({
        project_id: project.id,
        task_id: claimableTask.id,
        unit_id: unit.id,
        user_id: owner.id,
        status: "submitted",
      });

      const res = await post(
        app,
        `/api/v1/subtitles/units/${unit.id}/merge-jobs`,
        { claim_ids: [claim.id] },
        ownerToken
      );
      expectSuccess(res, 201);
    });

    it("POST /api/v1/tasks succeeds for a project member", async () => {
      const { project, unit, ownerToken } = await createOpenClaimScenario();

      const res = await post(
        app,
        "/api/v1/tasks",
        {
          project_id: project.id,
          unit_id: unit.id,
          title: "Member-created task",
          role: "timing",
        },
        ownerToken
      );
      expectSuccess(res, 201);
    });

    it("POST /api/v1/files/:fileId/versions/:versionId/approve succeeds for a project member", async () => {
      const { project, owner, ownerToken } = await createOpenClaimScenario();
      const { file, version } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
      });

      const res = await post(
        app,
        `/api/v1/files/${file.id}/versions/${version.id}/approve`,
        {},
        ownerToken
      );
      expectSuccess(res, 200);
    });

    it("DELETE /api/v1/tasks/:id succeeds for a project member", async () => {
      const { task, ownerToken } = await createOpenClaimScenario();

      const res = await del(app, `/api/v1/tasks/${task.id}`, ownerToken);
      expectSuccess(res, 200);
    });
  });

  describe("Control group: untagged outsider has no read access", () => {
    it("GET /api/v1/projects/:id is rejected for an outsider with no matching role tag", async () => {
      const { project, outsiderToken } = await createOpenClaimScenario();

      const res = await get(app, `/api/v1/projects/${project.id}`, outsiderToken);
      expectError(res, 403, "FORBIDDEN");
    });
  });
});
