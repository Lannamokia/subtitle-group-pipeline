import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestTemplate,
  createTestUnit,
  createTestTask,
  createTestFile,
  createTestStorageBackend,
  cleanDatabase,
} from "./setup";
import { post, get, put, del, expectSuccess, expectError } from "./helpers";
import type { Application } from "express";

describe("Project & Workflow Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp({ databaseReady: true });
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  describe("Template Instantiation", () => {
    it("should inherit delivery checklist from template", async () => {
      const { user, token } = await createTestUser();
      const checklist = [
        { item: "Source video acquired", required: true },
        { item: "Timing completed", required: true },
        { item: "Translation completed", required: true },
        { item: "QC passed", required: true },
      ];
      const template = await createTestTemplate({
        delivery_checklist: checklist,
      });
      const backend = await createTestStorageBackend();

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Templated Project",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 2,
        },
        token
      );

      expectSuccess(res, 201);

      const project = await prisma.project.findUnique({
        where: { id: res.body.data.id },
        include: { template: true },
      });

      expect(project!.template_id).toBe(template.id);
      expect(project!.storage_backend_id).toBe(backend.id);
      expect(project!.qq_group_id).toBe("123456789");
      expect(JSON.parse(project!.delivery_checklist!)).toEqual(checklist);
    });

    it("should require a project QQ group when creating from a template", async () => {
      const { token } = await createTestUser();
      const template = await createTestTemplate();
      const backend = await createTestStorageBackend();

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Missing Project Group",
          template_id: template.id,
          storage_backend_id: backend.id,
          season_count: 1,
          units_per_season: 1,
        },
        token
      );

      expectError(res, 400, "VALIDATION_ERROR");
    });

    it("should increase project units without creating default tasks", async () => {
      const { token } = await createTestUser();
      const template = await createTestTemplate({
        roles: [
          { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "translation", enabled: true, slotCount: 2, assignmentStrategy: "open_claim" },
        ],
      });
      const backend = await createTestStorageBackend();

      const createRes = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Resizable Project",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 1,
        },
        token
      );
      expectSuccess(createRes, 201);

      const resizeRes = await put(
        app,
        `/api/v1/projects/${createRes.body.data.id}/units/count`,
        {
          season_number: 1,
          units_per_season: 3,
        },
        token
      );
      expectSuccess(resizeRes, 200);
      expect(resizeRes.body.data).toHaveLength(3);

      const units = await prisma.projectUnit.findMany({
        where: { project_id: createRes.body.data.id },
        orderBy: { unit_number: "asc" },
      });
      expect(units.map((unit) => unit.unit_number)).toEqual([1, 2, 3]);

      const tasks = await prisma.task.findMany({
        where: { project_id: createRes.body.data.id },
      });
      expect(tasks).toHaveLength(0);
    });

    it("should reduce project units without requiring default tasks", async () => {
      const { token } = await createTestUser();
      const template = await createTestTemplate();
      const backend = await createTestStorageBackend();

      const createRes = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Protected Episodes",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 2,
        },
        token
      );
      expectSuccess(createRes, 201);

      const resizeRes = await put(
        app,
        `/api/v1/projects/${createRes.body.data.id}/units/count`,
        {
          season_number: 1,
          units_per_season: 1,
        },
        token
      );

      expectSuccess(resizeRes, 200);
      expect(resizeRes.body.data).toHaveLength(1);

      const units = await prisma.projectUnit.findMany({
        where: { project_id: createRes.body.data.id },
      });
      const tasks = await prisma.task.findMany({
        where: { project_id: createRes.body.data.id },
      });
      expect(units).toHaveLength(1);
      expect(tasks).toHaveLength(0);
    });

    it("should reduce project units by deleting selected episodes instead of only the tail", async () => {
      const { token } = await createTestUser();
      const template = await createTestTemplate();
      const backend = await createTestStorageBackend();

      const createRes = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Selected Episode Delete",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 4,
        },
        token
      );
      expectSuccess(createRes, 201);

      const secondUnit = await prisma.projectUnit.findFirstOrThrow({
        where: { project_id: createRes.body.data.id, unit_number: 2 },
      });

      const resizeRes = await put(
        app,
        `/api/v1/projects/${createRes.body.data.id}/units/count`,
        {
          season_number: 1,
          units_per_season: 3,
          delete_unit_ids: [secondUnit.id],
        },
        token
      );

      expectSuccess(resizeRes, 200);
      const units = await prisma.projectUnit.findMany({
        where: { project_id: createRes.body.data.id },
        orderBy: { unit_number: "asc" },
      });
      expect(units.map((unit) => unit.unit_number)).toEqual([1, 3, 4]);
    });

    it("should reject reducing episode count when removed episodes contain active work", async () => {
      const { user, token } = await createTestUser();
      const template = await createTestTemplate();
      const backend = await createTestStorageBackend();

      const createRes = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Protected Active Episodes",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 2,
        },
        token
      );
      expectSuccess(createRes, 201);

      const removedUnit = await prisma.projectUnit.findFirstOrThrow({
        where: { project_id: createRes.body.data.id, unit_number: 2 },
      });
      const removedTask = await createTestTask({
        project_id: createRes.body.data.id,
        unit_id: removedUnit.id,
        role: "translation",
        status: "claimable",
        creator_id: user.id,
      });
      await prisma.translationClaim.create({
        data: {
          task_id: removedTask.id,
          unit_id: removedUnit.id,
          user_id: user.id,
          segment_start: 0,
          segment_end: 120,
          status: "pending",
        },
      });

      const resizeRes = await put(
        app,
        `/api/v1/projects/${createRes.body.data.id}/units/count`,
        {
          season_number: 1,
          units_per_season: 1,
        },
        token
      );

      expectError(resizeRes, 409, "UNIT_NOT_EMPTY");
      expect(resizeRes.body.error.details.units[0].unit_number).toBe(2);
    });

    it("should force delete selected non-empty episodes after explicit confirmation", async () => {
      const { user, token } = await createTestUser();
      const template = await createTestTemplate();
      const backend = await createTestStorageBackend();

      const createRes = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Force Delete Episode",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 2,
        },
        token
      );
      expectSuccess(createRes, 201);

      const removedUnit = await prisma.projectUnit.findFirstOrThrow({
        where: { project_id: createRes.body.data.id, unit_number: 1 },
      });
      const removedTask = await createTestTask({
        project_id: createRes.body.data.id,
        unit_id: removedUnit.id,
        role: "translation",
        status: "claimable",
        creator_id: user.id,
      });
      const { file } = await createTestFile({
        project_id: createRes.body.data.id,
        uploader_id: user.id,
        metadata: JSON.stringify({ unit_id: removedUnit.id, task_id: removedTask.id }),
      });

      const resizeRes = await put(
        app,
        `/api/v1/projects/${createRes.body.data.id}/units/count`,
        {
          season_number: 1,
          units_per_season: 1,
          delete_unit_ids: [removedUnit.id],
          force_delete_non_empty: true,
        },
        token
      );

      expectSuccess(resizeRes, 200);
      const remainingUnits = await prisma.projectUnit.findMany({
        where: { project_id: createRes.body.data.id },
      });
      const removedTasks = await prisma.task.findMany({
        where: { unit_id: removedUnit.id },
      });
      const deletedFile = await prisma.fileEntity.findUnique({ where: { id: file.id } });

      expect(remainingUnits).toHaveLength(1);
      expect(remainingUnits[0].unit_number).toBe(2);
      expect(removedTasks).toHaveLength(0);
      expect(deletedFile!.is_deleted).toBe(true);
    });

    it("should inherit product config from template", async () => {
      const { user, token } = await createTestUser();
      const productConfig = {
        resolutions: ["1080p", "720p"],
        codecs: ["h264", "hevc"],
        containers: ["mkv", "mp4"],
      };
      const template = await createTestTemplate({
        product_config: productConfig,
      });
      const backend = await createTestStorageBackend();

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Product Config Project",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 1,
        },
        token
      );

      expectSuccess(res, 201);

      const project = await prisma.project.findUnique({
        where: { id: res.body.data.id },
      });

      const config = JSON.parse(project!.product_config!);
      expect(config.resolutions).toEqual(["1080p", "720p"]);
      expect(config.codecs).toEqual(["h264", "hevc"]);
    });

    it("should require an active storage backend when creating from a template", async () => {
      const { token } = await createTestUser();
      const template = await createTestTemplate();

      const missingRes = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Missing Backend Project",
          template_id: template.id,
          season_count: 1,
          units_per_season: 1,
        },
        token
      );
      expectError(missingRes, 400, "VALIDATION_ERROR");

      const inactiveBackend = await createTestStorageBackend({ is_active: false });
      const inactiveRes = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Inactive Backend Project",
          template_id: template.id,
          storage_backend_id: inactiveBackend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 1,
        },
        token
      );
      expectError(inactiveRes, 400, "BAD_REQUEST");
    });

    it("should snapshot template defaults so later template edits do not affect the project", async () => {
      const { token } = await createTestUser();
      const backend = await createTestStorageBackend();
      const template = await createTestTemplate({
        upload_policy: {
          roles: {
            translation: { fileTypes: ["subtitle"], extensions: [".ass"] },
          },
          maxSize: 2048,
          requireApproval: true,
          extensions: [".ass"],
        },
        notification_policy: { channels: ["in_site", "email"], events: ["task_assigned"] },
        ass_policy: { mergeRule: "strict", dedupThreshold: 0.2 },
        product_config: { resolutions: ["1080p"], codecs: ["hevc"], containers: ["mkv"] },
        release_task_type: "torrent+cloud_drive",
      });

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Snapshot Project",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 1,
        },
        token
      );

      expectSuccess(res, 201);

      await prisma.projectTemplate.update({
        where: { id: template.id },
        data: {
          product_config: JSON.stringify({ resolutions: ["480p"], codecs: ["h264"], containers: ["mp4"] }),
          release_task_type: "other",
        },
      });

      const project = await prisma.project.findUnique({ where: { id: res.body.data.id } });
      expect(JSON.parse(project!.product_config!).resolutions).toEqual(["1080p"]);
      expect(JSON.parse(project!.notification_policy!).channels).toEqual(["in_site", "email"]);
      expect(JSON.parse(project!.ass_policy!).mergeRule).toBe("strict");
      expect(project!.release_task_type).toBe("torrent+cloud_drive");

      const policy = await prisma.uploadPolicy.findFirst({ where: { project_id: project!.id } });
      expect(policy).toBeDefined();
      expect(policy!.max_size_bytes).toBe(2048);
      expect(policy!.require_approval).toBe(true);
      expect(JSON.parse(policy!.extension_whitelist!)).toEqual([".ass"]);
    });

    it("should snapshot template roles without creating default tasks", async () => {
      const { token } = await createTestUser();
      const template = await createTestTemplate({
        roles: [
          { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "translation", enabled: true, slotCount: 2, assignmentStrategy: "open_claim", maxSegmentsPerUser: 3 },
          { role: "encoding", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "release", enabled: false, slotCount: 1, assignmentStrategy: "manual" },
        ],
      });
      const backend = await createTestStorageBackend();

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Multi-Unit Project",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 3,
        },
        token
      );

      expectSuccess(res, 201);

      const tasks = await prisma.task.findMany({
        where: { project_id: res.body.data.id },
      });
      const project = await prisma.project.findUnique({
        where: { id: res.body.data.id },
      });

      expect(tasks).toHaveLength(0);
      expect(JSON.parse(project!.workflow_config!)).toEqual(JSON.parse(template.roles));
    });

    it("should not create task dependencies before supervisors create tasks", async () => {
      const { token } = await createTestUser();
      const template = await createTestTemplate({
        roles: [
          { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "translation", enabled: true, slotCount: 1, assignmentStrategy: "open_claim" },
        ],
      });
      const backend = await createTestStorageBackend();

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Dependency Project",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 1,
        },
        token
      );

      expectSuccess(res, 201);

      const dependencies = await prisma.taskDependency.findMany({
        where: {
          task: { project_id: res.body.data.id },
        },
      });

      expect(dependencies).toHaveLength(0);
    });
  });

  describe("Join Approval Flow", () => {
    it("should create join request and approve it", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: applicant, token: applicantToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      // Applicant creates join request
      const requestRes = await post(
        app,
        `/api/v1/projects/${project.id}/join`,
        { role: "translation", message: "I want to help translate" },
        applicantToken
      );

      expectSuccess(requestRes, 201);
      expect(requestRes.body.data.approved).toBeNull();

      // Owner approves the request
      const approveRes = await post(
        app,
        `/api/v1/projects/${project.id}/join-requests/${requestRes.body.data.id}/respond`,
        { approved: true },
        ownerToken
      );

      expectSuccess(approveRes, 200);
      expect(approveRes.body.data.approved).toBe(true);

      // Verify member was added
      const member = await prisma.projectMember.findUnique({
        where: {
          project_id_user_id: {
            project_id: project.id,
            user_id: applicant.id,
          },
        },
      });

      expect(member).toBeDefined();
      expect(member!.role).toBe("translation");
    });

    it("should reject join request", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: applicant, token: applicantToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      const requestRes = await post(
        app,
        `/api/v1/projects/${project.id}/join`,
        { role: "translation" },
        applicantToken
      );

      const rejectRes = await post(
        app,
        `/api/v1/projects/${project.id}/join-requests/${requestRes.body.data.id}/respond`,
        { approved: false },
        ownerToken
      );

      expectSuccess(rejectRes, 200);
      expect(rejectRes.body.data.approved).toBe(false);

      const member = await prisma.projectMember.findUnique({
        where: {
          project_id_user_id: {
            project_id: project.id,
            user_id: applicant.id,
          },
        },
      });

      expect(member).toBeNull();
    });

    it("should prevent duplicate join requests", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: applicant, token: applicantToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await post(
        app,
        `/api/v1/projects/${project.id}/join`,
        { role: "translation" },
        applicantToken
      );

      const duplicateRes = await post(
        app,
        `/api/v1/projects/${project.id}/join`,
        { role: "translation" },
        applicantToken
      );

      expectError(duplicateRes, 409, "DUPLICATE_ERROR");
    });

    it("should prevent joining if already a member", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: member, token: memberToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await prisma.projectMember.create({
        data: {
          project_id: project.id,
          user_id: member.id,
          role: "translation",
        },
      });

      const res = await post(
        app,
        `/api/v1/projects/${project.id}/join`,
        { role: "timing" },
        memberToken
      );

      expectError(res, 409, "DUPLICATE_ERROR");
    });
  });

  describe("Competitive Translation Segment Claiming", () => {
    it("should allow claiming non-overlapping segments", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 1440 });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: translator.id, role: "translation" },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      const claimRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 300 },
        translatorToken
      );

      expectSuccess(claimRes, 201);
      expect(claimRes.body.data.segment_start).toBe(0);
      expect(claimRes.body.data.segment_end).toBe(300);
      expect(claimRes.body.data.status).toBe("active");
    });

    it("should reject overlapping segment claims", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: t1, token: t1Token } = await createTestUser();
      const { user: t2, token: t2Token } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 1440 });

      await prisma.projectMember.createMany({
        data: [
          { project_id: project.id, user_id: t1.id, role: "translation" },
          { project_id: project.id, user_id: t2.id, role: "translation" },
        ],
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      // First claim
      await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 100, segment_end: 500 },
        t1Token
      );

      // Overlapping claim
      const overlapRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 400, segment_end: 800 },
        t2Token
      );

      expectError(overlapRes, 409, "CONFLICT");
    });

    it("should enforce per-user segment limit (max 3)", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 2000 });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: translator.id, role: "translation" },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      // Claim 3 segments
      for (let i = 0; i < 3; i++) {
        const res = await post(
          app,
          `/api/v1/tasks/${task.id}/claim-segment`,
          { segment_start: i * 500, segment_end: (i * 500) + 400 },
          translatorToken
        );
        expectSuccess(res, 201);
      }

      // 4th claim should fail
      const fourthRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 2000, segment_end: 2400 },
        translatorToken
      );

      expectError(fourthRes, 400, "BAD_REQUEST");
    });

    it("should validate segment within episode length", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 300 });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: translator.id, role: "translation" },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      const res = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 500 },
        translatorToken
      );

      expectError(res, 400, "VALIDATION_ERROR");
    });

    it("should allow adjacent segments, lock when fully claimed, and unlock after abandon", async () => {
      const { user: owner } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 600 });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: translator.id, role: "translation" },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      const first = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 300 },
        translatorToken
      );
      expectSuccess(first, 201);

      const second = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 300, segment_end: 600 },
        translatorToken
      );
      expectSuccess(second, 201);

      const lockedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(lockedTask!.status).toBe("assigned");

      const lockedClaim = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 100 },
        translatorToken
      );
      expectError(lockedClaim, 400, "BAD_REQUEST");

      const abandonRes = await post(
        app,
        `/api/v1/tasks/${task.id}/abandon-segment/${first.body.data.id}`,
        {},
        translatorToken
      );
      expectSuccess(abandonRes, 200);

      const reopenedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(reopenedTask!.status).toBe("claimable");
    });

    it("should enforce project max segment length and granted translation tags", async () => {
      const { user: owner } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 600 });
      const tag = await prisma.roleTag.create({
        data: { name: "translation", description: "Translation eligibility" },
      });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            { role: "translation", maxSegmentLength: 120 },
          ]),
        },
      });
      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: translator.id, role: "translation" },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      const noTagRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 60 },
        translatorToken
      );
      expectError(noTagRes, 403, "FORBIDDEN");

      await prisma.tagApplication.create({
        data: {
          user_id: translator.id,
          tag_id: tag.id,
          approved: true,
          approved_by: owner.id,
          approved_at: new Date(),
        },
      });

      const tooLongRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 180 },
        translatorToken
      );
      expectError(tooLongRes, 400, "BAD_REQUEST");

      const allowedRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 120 },
        translatorToken
      );
      expectSuccess(allowedRes, 201);
      expect(allowedRes.body.data.unit_id).toBe(unit.id);
    });
  });

  describe("Task Cancellation and Downstream Freezing", () => {
    it("should freeze unstarted downstream tasks on cancellation", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      // Create a chain of tasks
      const task1 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "in_progress",
        creator_id: owner.id,
      });

      const task2 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "claimable",
        creator_id: owner.id,
      });

      const task3 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "pending_publish",
        creator_id: owner.id,
      });

      // Create dependencies
      await prisma.taskDependency.create({
        data: {
          task_id: task2.id,
          depends_on_id: task1.id,
          dependency_type: "finish_to_start",
        },
      });
      await prisma.taskDependency.create({
        data: {
          task_id: task3.id,
          depends_on_id: task2.id,
          dependency_type: "finish_to_start",
        },
      });

      // Cancel task1
      const cancelRes = await post(
        app,
        `/api/v1/tasks/${task1.id}/cancel`,
        {},
        ownerToken
      );

      expectSuccess(cancelRes, 200);

      // Check downstream tasks are frozen
      const frozenTask2 = await prisma.task.findUnique({ where: { id: task2.id } });
      const frozenTask3 = await prisma.task.findUnique({ where: { id: task3.id } });

      expect(frozenTask2!.status).toBe("frozen");
      expect(frozenTask3!.status).toBe("frozen");
      expect(frozenTask2!.frozen_at).not.toBeNull();
      expect(frozenTask3!.frozen_at).not.toBeNull();
    });

    it("should warn for in-progress downstream tasks", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task1 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "in_progress",
        creator_id: owner.id,
      });

      const task2 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "in_progress",
        assignee_id: worker.id,
        creator_id: owner.id,
      });

      await prisma.taskDependency.create({
        data: {
          task_id: task2.id,
          depends_on_id: task1.id,
          dependency_type: "finish_to_start",
        },
      });

      const cancelRes = await post(
        app,
        `/api/v1/tasks/${task1.id}/cancel`,
        {},
        ownerToken
      );

      expectSuccess(cancelRes, 200);
      expect(cancelRes.body.data.warned.length).toBeGreaterThan(0);
    });
  });

  describe("Task Deletion", () => {
    it("should delete an empty task, clear task notifications, and unlock downstream tasks", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "claimable",
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "pending_publish",
        creator_id: owner.id,
      });

      await prisma.taskDependency.create({
        data: {
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });
      const notification = await prisma.notification.create({
        data: {
          user_id: worker.id,
          type: "task_assigned",
          title: "Task assigned",
          project_id: project.id,
          task_id: upstream.id,
          actor_id: owner.id,
          channels: JSON.stringify(["in_site"]),
        },
      });

      const deleteRes = await del(app, `/api/v1/tasks/${upstream.id}`, ownerToken);

      expectSuccess(deleteRes, 200);
      expect(deleteRes.body.data.id).toBe(upstream.id);

      const deletedTask = await prisma.task.findUnique({ where: { id: upstream.id } });
      const dependencyCount = await prisma.taskDependency.count({
        where: {
          OR: [
            { task_id: upstream.id },
            { depends_on_id: upstream.id },
          ],
        },
      });
      const updatedNotification = await prisma.notification.findUnique({ where: { id: notification.id } });
      const updatedDownstream = await prisma.task.findUnique({ where: { id: downstream.id } });

      expect(deletedTask).toBeNull();
      expect(dependencyCount).toBe(0);
      expect(updatedNotification!.task_id).toBeNull();
      expect(updatedDownstream!.status).toBe("claimable");
    });

    it("should prevent deleting tasks that already contain active work", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      await prisma.translationClaim.create({
        data: {
          task_id: task.id,
          unit_id: unit.id,
          user_id: worker.id,
          segment_start: 0,
          segment_end: 120,
        },
      });

      const deleteRes = await del(app, `/api/v1/tasks/${task.id}`, ownerToken);

      expectError(deleteRes, 400, "BAD_REQUEST");
      expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
    });

    it("should prevent non-supervisors from deleting project tasks", async () => {
      const { user: owner } = await createTestUser();
      const { token: memberToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      const deleteRes = await del(app, `/api/v1/tasks/${task.id}`, memberToken);

      expectError(deleteRes, 403, "FORBIDDEN");
      expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
    });
  });

  describe("Active Task Return", () => {
    it("should allow assignee to return an assigned task", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "assigned",
        assignee_id: worker.id,
        creator_id: owner.id,
      });

      const returnRes = await post(
        app,
        `/api/v1/tasks/${task.id}/return`,
        {},
        workerToken
      );

      expectSuccess(returnRes, 200);

      const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(updatedTask!.status).toBe("claimable");
      expect(updatedTask!.assignee_id).toBeNull();
    });

    it("should prevent non-assignee from returning a task", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const { user: other, token: otherToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "assigned",
        assignee_id: worker.id,
        creator_id: owner.id,
      });

      const returnRes = await post(
        app,
        `/api/v1/tasks/${task.id}/return`,
        {},
        otherToken
      );

      expectError(returnRes, 403, "FORBIDDEN");
    });
  });

  describe("Dependency Gating", () => {
    it("should prevent claiming task when dependencies not met", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: worker.id, role: "timing" },
      });

      const task1 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "in_progress",
        creator_id: owner.id,
      });

      const task2 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "claimable",
        creator_id: owner.id,
      });

      await prisma.taskDependency.create({
        data: {
          task_id: task2.id,
          depends_on_id: task1.id,
          dependency_type: "finish_to_start",
        },
      });

      const claimRes = await post(
        app,
        `/api/v1/tasks/${task2.id}/claim`,
        {},
        workerToken
      );

      expectError(claimRes, 400, "DEPENDENCY_NOT_MET");
    });

    it("should allow claiming when dependencies are completed", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: worker.id, role: "timing" },
      });

      const task1 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "completed",
        creator_id: owner.id,
      });

      const task2 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "claimable",
        creator_id: owner.id,
      });

      await prisma.taskDependency.create({
        data: {
          task_id: task2.id,
          depends_on_id: task1.id,
          dependency_type: "finish_to_start",
        },
      });

      const claimRes = await post(
        app,
        `/api/v1/tasks/${task2.id}/claim`,
        {},
        workerToken
      );

      expectSuccess(claimRes, 200);
    });

    it("should restrict open claim tasks to configured role tags", async () => {
      const { user: owner } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });
      const allowedTag = await prisma.roleTag.create({
        data: { name: "Senior Timing", role_type: "timing" },
      });
      const otherTag = await prisma.roleTag.create({
        data: { name: "Junior Timing", role_type: "timing" },
      });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            {
              role: "timing",
              enabled: true,
              slotCount: 1,
              assignmentStrategy: "open_claim",
              requiredTagIds: [allowedTag.id],
            },
          ]),
        },
      });
      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: worker.id, role: "timing" },
      });
      await prisma.tagApplication.create({
        data: {
          user_id: worker.id,
          tag_id: otherTag.id,
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

      const rejected = await post(app, `/api/v1/tasks/${task.id}/claim`, {}, workerToken);
      expectError(rejected, 403, "FORBIDDEN");

      await prisma.tagApplication.create({
        data: {
          user_id: worker.id,
          tag_id: allowedTag.id,
          approved: true,
          approved_by: owner.id,
          approved_at: new Date(),
        },
      });

      const accepted = await post(app, `/api/v1/tasks/${task.id}/claim`, {}, workerToken);
      expectSuccess(accepted, 200);
    });
  });

  describe("Pipeline Review Gates", () => {
    it("should require review for translation tasks before completion", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: translator.id,
        creator_id: owner.id,
      });

      // Translator submits
      const submitRes = await post(
        app,
        `/api/v1/tasks/${task.id}/submit`,
        {},
        translatorToken
      );

      expectSuccess(submitRes, 200);

      const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(updatedTask!.status).toBe("submitted");
      expect(updatedTask!.submitted_at).not.toBeNull();
    });

    it("should approve task and unlock downstream", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task1 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "submitted",
        assignee_id: translator.id,
        creator_id: owner.id,
      });

      const task2 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "pending_publish",
        creator_id: owner.id,
      });

      await prisma.taskDependency.create({
        data: {
          task_id: task2.id,
          depends_on_id: task1.id,
          dependency_type: "finish_to_start",
        },
      });

      // Supervisor approves
      const approveRes = await post(
        app,
        `/api/v1/tasks/${task1.id}/approve`,
        { approved: true, comments: "Looks good" },
        ownerToken
      );

      expectSuccess(approveRes, 200);

      const approvedTask = await prisma.task.findUnique({ where: { id: task1.id } });
      expect(approvedTask!.status).toBe("completed");

      // Downstream should be claimable
      const downstreamTask = await prisma.task.findUnique({ where: { id: task2.id } });
      expect(downstreamTask!.status).toBe("claimable");
    });

    it("should complete source and timing submissions without review and unlock downstream", async () => {
      const { user: owner } = await createTestUser();
      const { user: sourceUser, token: sourceToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const sourceTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "in_progress",
        assignee_id: sourceUser.id,
        creator_id: owner.id,
      });
      const timingTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "pending_publish",
        creator_id: owner.id,
      });
      await prisma.taskDependency.create({
        data: {
          task_id: timingTask.id,
          depends_on_id: sourceTask.id,
          dependency_type: "finish_to_start",
        },
      });

      const submitRes = await post(
        app,
        `/api/v1/tasks/${sourceTask.id}/submit`,
        {},
        sourceToken
      );
      expectSuccess(submitRes, 200);

      const completedSource = await prisma.task.findUnique({ where: { id: sourceTask.id } });
      const unlockedTiming = await prisma.task.findUnique({ where: { id: timingTask.id } });
      expect(completedSource!.status).toBe("completed");
      expect(completedSource!.completed_at).not.toBeNull();
      expect(unlockedTiming!.status).toBe("claimable");

      const reviews = await prisma.review.findMany({ where: { task_id: sourceTask.id } });
      expect(reviews).toHaveLength(0);
    });

    it.each(["translation", "post_production", "encoding", "release"] as const)(
      "should keep %s submissions waiting for supervisor approval",
      async (role) => {
        const { user: owner } = await createTestUser();
        const { user: worker, token: workerToken } = await createTestUser();
        const project = await createTestProject({ owner_id: owner.id });
        const unit = await createTestUnit({ project_id: project.id });

        const task = await createTestTask({
          project_id: project.id,
          unit_id: unit.id,
          role,
          status: "in_progress",
          assignee_id: worker.id,
          creator_id: owner.id,
        });

        const submitRes = await post(
          app,
          `/api/v1/tasks/${task.id}/submit`,
          {},
          workerToken
        );
        expectSuccess(submitRes, 200);

        const submittedTask = await prisma.task.findUnique({ where: { id: task.id } });
        expect(submittedTask!.status).toBe("submitted");
        expect(submittedTask!.completed_at).toBeNull();
      }
    );
  });

  describe("Supervisory Overrides", () => {
    it("should allow supervisor to assign task regardless of dependencies", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: owner.id, role: "supervisor", is_lead: true },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });

      // Supervisor assigns directly
      const assignRes = await post(
        app,
        `/api/v1/tasks/${task.id}/assign`,
        { assignee_id: worker.id },
        ownerToken
      );

      expectSuccess(assignRes, 200);
      expect(assignRes.body.data.assignee_id).toBe(worker.id);
    });

    it("should require an override reason when supervisor assigns before dependencies are met", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: owner.id, role: "supervisor", is_lead: true },
      });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "in_progress",
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "claimable",
        creator_id: owner.id,
      });
      await prisma.taskDependency.create({
        data: {
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });

      const assignRes = await post(
        app,
        `/api/v1/tasks/${downstream.id}/assign`,
        { assignee_id: worker.id },
        ownerToken
      );

      expectError(assignRes, 400, "VALIDATION_ERROR");
    });

    it("should audit supervisor dependency override assignments with a reason", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: owner.id, role: "supervisor", is_lead: true },
      });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "in_progress",
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "claimable",
        creator_id: owner.id,
      });
      await prisma.taskDependency.create({
        data: {
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });

      const assignRes = await post(
        app,
        `/api/v1/tasks/${downstream.id}/assign`,
        {
          assignee_id: worker.id,
          override_reason: "Source will be delivered out-of-band",
        },
        ownerToken
      );

      expectSuccess(assignRes, 200);

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: "task.override_assign",
          resource_id: downstream.id,
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog!.new_value).toContain("Source will be delivered out-of-band");
    });
  });

  describe("Downstream Cascade Reset on Task Modification", () => {
    it("should reset downstream completed tasks when upstream is modified", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task1 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "completed",
        creator_id: owner.id,
      });

      const task2 = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "completed",
        creator_id: owner.id,
      });

      const releaseTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "release",
        status: "submitted",
        creator_id: owner.id,
      });

      await prisma.taskDependency.create({
        data: {
          task_id: task2.id,
          depends_on_id: task1.id,
          dependency_type: "finish_to_start",
        },
      });
      await prisma.taskDependency.create({
        data: {
          task_id: releaseTask.id,
          depends_on_id: task2.id,
          dependency_type: "finish_to_start",
        },
      });

      const { file: releaseFile } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
        name: "release.torrent",
        file_type: "other",
        metadata: JSON.stringify({ task_id: releaseTask.id, role: "release" }),
      });
      await prisma.linkHistory.create({
        data: {
          project_id: project.id,
          file_id: releaseFile.id,
          url: "https://drive.example/release",
          link_type: "cloud_drive",
          created_by: owner.id,
        },
      });

      // Modify task1 (content change triggers cascade reset)
      const updateRes = await put(
        app,
        `/api/v1/tasks/${task1.id}`,
        { title: "Updated Translation Task" },
        ownerToken
      );

      expectSuccess(updateRes, 200);

      // Task2 should be reset to in_progress
      const resetTask = await prisma.task.findUnique({ where: { id: task2.id } });
      expect(resetTask!.status).toBe("in_progress");
      expect(resetTask!.completed_at).toBeNull();

      const resetReleaseTask = await prisma.task.findUnique({ where: { id: releaseTask.id } });
      expect(resetReleaseTask!.status).toBe("pending_publish");
      expect(resetReleaseTask!.submitted_at).toBeNull();

      const discardedFile = await prisma.fileEntity.findUnique({ where: { id: releaseFile.id } });
      expect(discardedFile!.is_deleted).toBe(true);
      const releaseLinks = await prisma.linkHistory.findMany({ where: { file_id: releaseFile.id } });
      expect(releaseLinks).toHaveLength(0);
    });
  });

  describe("Role-Specific Reset Behavior", () => {
    it("should retain file history for non-release roles on reset", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "submitted",
        assignee_id: worker.id,
        creator_id: owner.id,
      });

      // Create a file version associated with the task
      const { file, version } = await createTestFile({
        project_id: project.id,
        uploader_id: worker.id,
        name: "translation.ass",
        file_type: "subtitle",
      });

      // Reset the task
      const resetRes = await post(
        app,
        `/api/v1/tasks/${task.id}/reset`,
        { reason: "Needs revision" },
        ownerToken
      );

      expectSuccess(resetRes, 200);

      // File entity should still exist
      const existingFile = await prisma.fileEntity.findUnique({
        where: { id: file.id },
      });
      expect(existingFile).toBeDefined();
      expect(existingFile!.is_deleted).toBe(false);

      // Version should still exist
      const existingVersion = await prisma.fileVersion.findUnique({
        where: { id: version.id },
      });
      expect(existingVersion).toBeDefined();
    });

    it("should discard artifacts for release role on reset", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "release",
        status: "submitted",
        assignee_id: worker.id,
        creator_id: owner.id,
      });

      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: worker.id,
        name: "release.torrent",
        file_type: "other",
        metadata: JSON.stringify({ task_id: task.id, role: "release" }),
      });

      // Reset the task
      const resetRes = await post(
        app,
        `/api/v1/tasks/${task.id}/reset`,
        { reason: "Release failed" },
        ownerToken
      );

      expectSuccess(resetRes, 200);

      const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(updatedTask!.status).toBe("in_progress");
      expect(updatedTask!.submitted_at).toBeNull();
      expect(updatedTask!.completed_at).toBeNull();

      const discardedFile = await prisma.fileEntity.findUnique({
        where: { id: file.id },
      });
      expect(discardedFile!.is_deleted).toBe(true);
    });
  });
});
