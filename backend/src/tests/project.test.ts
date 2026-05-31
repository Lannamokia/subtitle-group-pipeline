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

  async function seedTranslationClaimFile({
    projectId,
    taskId,
    unitId,
    userId,
    segmentStart = 0,
    segmentEnd = 60,
    status = "active",
  }: {
    projectId: string;
    taskId: string;
    unitId: string;
    userId: string;
    segmentStart?: number;
    segmentEnd?: number;
    status?: "active" | "submitted" | "approved";
  }) {
    const claim = await prisma.translationClaim.create({
      data: {
        task_id: taskId,
        unit_id: unitId,
        user_id: userId,
        segment_start: segmentStart,
        segment_end: segmentEnd,
        status,
        submitted_at: status === "submitted" || status === "approved" ? new Date() : null,
        approved_at: status === "approved" ? new Date() : null,
      },
    });
    const { version } = await createTestFile({
      project_id: projectId,
      uploader_id: userId,
      name: `${taskId}.ass`,
      metadata: JSON.stringify({ task_id: taskId, unit_id: unitId, role: "translation" }),
    });

    if (status === "submitted" || status === "approved") {
      await prisma.translationSubmission.create({
        data: {
          task_id: taskId,
          user_id: userId,
          claim_id: claim.id,
          file_version_id: version.id,
          content: "",
          line_count: null,
        },
      });
    }

    return { claim, version };
  }

  describe("Project Listing", () => {
    it("should expose members and assigned users for participated project filtering", async () => {
      const { user: owner, token } = await createTestUser();
      const { user: member } = await createTestUser();
      const { user: assignee } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await prisma.projectMember.create({
        data: {
          project_id: project.id,
          user_id: member.id,
          role: "translation",
        },
      });
      await createTestTask({
        project_id: project.id,
        creator_id: owner.id,
        assignee_id: assignee.id,
        role: "timing",
        status: "assigned",
      });

      const res = await get(app, "/api/v1/projects", token);

      expectSuccess(res, 200);
      const listedProject = res.body.data.find((item: { id: string }) => item.id === project.id);
      expect(listedProject).toBeDefined();
      expect(listedProject.members.some((item: { user: { id: string } }) => item.user.id === member.id)).toBe(true);
      expect(listedProject.assigned_user_ids).toContain(assignee.id);
    });
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

    it("should normalize empty template upload policy snapshots to default role rules", async () => {
      const { token } = await createTestUser();
      const backend = await createTestStorageBackend();
      const template = await createTestTemplate({
        upload_policy: { allowedTypes: {} },
      });

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Default Upload Policy Project",
          template_id: template.id,
          storage_backend_id: backend.id,
          qq_group_id: "123456789",
          season_count: 1,
          units_per_season: 1,
        },
        token
      );

      expectSuccess(res, 201);

      const project = await prisma.project.findUnique({ where: { id: res.body.data.id } });
      const snapshot = JSON.parse(project!.upload_policy_config!);
      expect(snapshot.roles.translation.file_types).toContain("subtitle");
      expect(snapshot.roles.encoding.file_types).toContain("video");

      const policy = await prisma.uploadPolicy.findFirst({ where: { project_id: project!.id } });
      const policyConfig = JSON.parse(policy!.allowed_types);
      expect(policyConfig.roles.translation.file_types).toContain("subtitle");
      expect(JSON.parse(policy!.extension_whitelist!)).toContain(".ass");
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

    it("should reject whole-task claiming for translation tasks", async () => {
      const { user: owner } = await createTestUser();
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

      const res = await post(
        app,
        `/api/v1/tasks/${task.id}/claim`,
        {},
        translatorToken
      );

      expectError(res, 400, "BAD_REQUEST");
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

    it("should share claimed segments across translation tasks in the same unit", async () => {
      const { user: owner } = await createTestUser();
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

      const taskOne = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "claimable",
        creator_id: owner.id,
      });
      const taskTwo = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "assigned",
        assignee_id: t2.id,
        creator_id: owner.id,
      });

      const claimRes = await post(
        app,
        `/api/v1/tasks/${taskOne.id}/claim-segment`,
        { segment_start: 100, segment_end: 500 },
        t1Token
      );
      expectSuccess(claimRes, 201);

      const claimedTaskOne = await prisma.task.findUnique({ where: { id: taskOne.id } });
      const unchangedTaskTwo = await prisma.task.findUnique({ where: { id: taskTwo.id } });
      expect(claimedTaskOne!.status).toBe("assigned");
      expect(claimedTaskOne!.assignee_id).toBe(t1.id);
      expect(unchangedTaskTwo!.status).toBe("assigned");
      expect(unchangedTaskTwo!.assignee_id).toBe(t2.id);

      const taskTwoDetail = await get(app, `/api/v1/tasks/${taskTwo.id}`, t2Token);
      expectSuccess(taskTwoDetail, 200);
      expect(taskTwoDetail.body.data.claims).toHaveLength(1);
      expect(taskTwoDetail.body.data.claims[0].task_id).toBe(taskOne.id);
      expect(taskTwoDetail.body.data.claims[0].segment_start).toBe(100);
      expect(taskTwoDetail.body.data.claims[0].segment_end).toBe(500);

      const overlapRes = await post(
        app,
        `/api/v1/tasks/${taskTwo.id}/claim-segment`,
        { segment_start: 400, segment_end: 800 },
        t2Token
      );
      expectError(overlapRes, 409, "CONFLICT");

      const abandonRes = await post(
        app,
        `/api/v1/tasks/${taskOne.id}/abandon-segment/${claimRes.body.data.id}`,
        {},
        t1Token
      );
      expectSuccess(abandonRes, 200);

      const abandonedTaskOne = await prisma.task.findUnique({ where: { id: taskOne.id } });
      const stillUnchangedTaskTwo = await prisma.task.findUnique({ where: { id: taskTwo.id } });
      expect(abandonedTaskOne!.status).toBe("claimable");
      expect(abandonedTaskOne!.assignee_id).toBeNull();
      expect(stillUnchangedTaskTwo!.status).toBe("assigned");
      expect(stillUnchangedTaskTwo!.assignee_id).toBe(t2.id);
    });

    it("should enforce per-user maximum claimed translation duration", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 2000 });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            { role: "translation", maxSegmentLength: 900 },
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

      for (const [segment_start, segment_end] of [[0, 400], [500, 900]]) {
        const res = await post(
          app,
          `/api/v1/tasks/${task.id}/claim-segment`,
          { segment_start, segment_end },
          translatorToken
        );
        expectSuccess(res, 201);
      }

      const overflowRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 900, segment_end: 1100 },
        translatorToken
      );

      expectError(overflowRes, 400, "BAD_REQUEST");
    });

    it("should allow project supervisors to override translation claim duration in project settings", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 1200 });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            { role: "translation", maxSegmentLength: 900 },
          ]),
        },
      });

      const updateRes = await put(
        app,
        `/api/v1/projects/${project.id}`,
        { translation_max_segment_length: 500 },
        ownerToken
      );
      expectSuccess(updateRes, 200);

      const updatedProject = await prisma.project.findUnique({ where: { id: project.id } });
      const workflow = JSON.parse(updatedProject!.workflow_config || "[]");
      expect(workflow.find((entry: { role?: string }) => entry.role === "translation").maxSegmentLength).toBe(500);

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

      const allowedRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 0, segment_end: 400 },
        translatorToken
      );
      expectSuccess(allowedRes, 201);

      const overflowRes = await post(
        app,
        `/api/v1/tasks/${task.id}/claim-segment`,
        { segment_start: 400, segment_end: 600 },
        translatorToken
      );
      expectError(overflowRes, 400, "BAD_REQUEST");
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

    it("should not unlock downstream tasks when the deleted task was the configured predecessor stage", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
            { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          ]),
        },
      });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "source",
        status: "completed",
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "in_progress",
        creator_id: owner.id,
      });

      const deleteRes = await del(app, `/api/v1/tasks/${upstream.id}`, ownerToken);
      expectSuccess(deleteRes, 200);

      const updatedDownstream = await prisma.task.findUnique({ where: { id: downstream.id } });
      expect(updatedDownstream!.status).toBe("pending_publish");
      expect(updatedDownstream!.started_at).toBeNull();
    });

    it("should allow supervisors to delete active tasks and reset downstream tasks", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });
      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: worker.id,
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "completed",
        assignee_id: worker.id,
        creator_id: owner.id,
        completed_at: new Date(),
      });

      await prisma.taskDependency.create({
        data: {
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });

      await prisma.translationClaim.create({
        data: {
          task_id: upstream.id,
          unit_id: unit.id,
          user_id: worker.id,
          segment_start: 0,
          segment_end: 120,
        },
      });
      await prisma.comment.create({
        data: {
          user_id: worker.id,
          task_id: upstream.id,
          content: "Work notes before deletion",
        },
      });
      const review = await prisma.review.create({
        data: {
          project_id: project.id,
          task_id: upstream.id,
          reviewer_id: owner.id,
          requester_id: worker.id,
          status: "pending",
        },
      });

      const deleteRes = await del(app, `/api/v1/tasks/${upstream.id}`, ownerToken);

      expectSuccess(deleteRes, 200);

      const deletedTask = await prisma.task.findUnique({ where: { id: upstream.id } });
      const resetDownstream = await prisma.task.findUnique({ where: { id: downstream.id } });
      const detachedReview = await prisma.review.findUnique({ where: { id: review.id } });

      expect(deletedTask).toBeNull();
      expect(await prisma.translationClaim.count({ where: { task_id: upstream.id } })).toBe(0);
      expect(await prisma.comment.count({ where: { task_id: upstream.id } })).toBe(0);
      expect(detachedReview!.task_id).toBeNull();
      expect(resetDownstream!.status).toBe("in_progress");
      expect(resetDownstream!.completed_at).toBeNull();
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

    it("should allow supervisors to force return in-progress tasks and cascade downstream reset", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: worker.id,
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "completed",
        assignee_id: worker.id,
        creator_id: owner.id,
        completed_at: new Date(),
      });

      await prisma.taskDependency.create({
        data: {
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });

      const returnRes = await post(
        app,
        `/api/v1/tasks/${upstream.id}/return`,
        {},
        ownerToken
      );

      expectSuccess(returnRes, 200);

      const returnedTask = await prisma.task.findUnique({ where: { id: upstream.id } });
      const resetDownstream = await prisma.task.findUnique({ where: { id: downstream.id } });

      expect(returnedTask!.status).toBe("claimable");
      expect(returnedTask!.assignee_id).toBeNull();
      expect(resetDownstream!.status).toBe("in_progress");
      expect(resetDownstream!.completed_at).toBeNull();
    });
  });

  describe("Dependency Gating", () => {
    it("should keep newly preassigned downstream tasks blocked until dependencies complete", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const upstreamRes = await post(
        app,
        "/api/v1/tasks",
        {
          project_id: project.id,
          unit_id: unit.id,
          title: "片源整理",
          role: "source",
          assignee_id: worker.id,
        },
        ownerToken
      );
      expectSuccess(upstreamRes, 201);

      const downstreamRes = await post(
        app,
        "/api/v1/tasks",
        {
          project_id: project.id,
          unit_id: unit.id,
          title: "时轴制作",
          role: "timing",
          assignee_id: worker.id,
        },
        ownerToken
      );
      expectSuccess(downstreamRes, 201);

      const upstreamId = upstreamRes.body.data.id;
      const downstreamId = downstreamRes.body.data.id;

      const depRes = await post(
        app,
        `/api/v1/tasks/${downstreamId}/dependencies`,
        { depends_on_id: upstreamId },
        ownerToken
      );
      expectSuccess(depRes, 201);

      const blockedDownstream = await prisma.task.findUnique({ where: { id: downstreamId } });
      expect(blockedDownstream!.status).toBe("pending_publish");
      expect(blockedDownstream!.assignee_id).toBe(worker.id);

      const startBlockedRes = await post(
        app,
        `/api/v1/tasks/${downstreamId}/start`,
        {},
        workerToken
      );
      expectError(startBlockedRes, 400, "BAD_REQUEST");

      const startUpstreamRes = await post(
        app,
        `/api/v1/tasks/${upstreamId}/start`,
        {},
        workerToken
      );
      expectSuccess(startUpstreamRes, 200);

      const submitUpstreamRes = await post(
        app,
        `/api/v1/tasks/${upstreamId}/submit`,
        {},
        workerToken
      );
      expectSuccess(submitUpstreamRes, 200);

      const unlockedDownstream = await prisma.task.findUnique({ where: { id: downstreamId } });
      expect(unlockedDownstream!.status).toBe("assigned");
      expect(unlockedDownstream!.assignee_id).toBe(worker.id);
    });

    it("should allow preassigning a blocked pending task without forcing a dependency override", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

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

      const assignRes = await post(
        app,
        `/api/v1/tasks/${downstream.id}/assign`,
        { assignee_id: worker.id },
        ownerToken
      );

      expectSuccess(assignRes, 200);
      expect(assignRes.body.data.status).toBe("pending_publish");
      expect(assignRes.body.data.assignee_id).toBe(worker.id);
    });

    it("should keep configured downstream tasks blocked when the predecessor stage has no tasks", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
            { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          ]),
        },
      });
      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: worker.id, role: "timing" },
      });

      const createRes = await post(
        app,
        "/api/v1/tasks",
        {
          project_id: project.id,
          unit_id: unit.id,
          title: "时轴制作",
          role: "timing",
          assignee_id: worker.id,
        },
        ownerToken
      );
      expectSuccess(createRes, 201);
      expect(createRes.body.data.status).toBe("pending_publish");

      const strayTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "claimable",
        creator_id: owner.id,
      });
      const claimRes = await post(app, `/api/v1/tasks/${strayTask.id}/claim`, {}, workerToken);
      expectError(claimRes, 400, "DEPENDENCY_NOT_MET");
    });

    it("should make the first configured source task claimable without a predecessor", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
            { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          ]),
        },
      });

      const createRes = await post(
        app,
        "/api/v1/tasks",
        {
          project_id: project.id,
          unit_id: unit.id,
          title: "片源整理",
          role: "source",
        },
        ownerToken
      );

      expectSuccess(createRes, 201);
      expect(createRes.body.data.status).toBe("claimable");
    });

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
      await seedTranslationClaimFile({
        projectId: project.id,
        taskId: task.id,
        unitId: unit.id,
        userId: translator.id,
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
      await seedTranslationClaimFile({
        projectId: project.id,
        taskId: task1.id,
        unitId: unit.id,
        userId: translator.id,
        status: "submitted",
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

    it("should complete all translation tasks and unlock post-production when all translation work is approved", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translatorOne } = await createTestUser();
      const { user: translatorTwo } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id, episode_length: 10_000 });

      await prisma.project.update({
        where: { id: project.id },
        data: {
          workflow_config: JSON.stringify([
            { role: "translation", enabled: true, slotCount: 2, assignmentStrategy: "open_claim" },
            { role: "post_production", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          ]),
        },
      });

      const translationOne = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "review_approved",
        assignee_id: translatorOne.id,
        creator_id: owner.id,
        translation_order: 1,
      });
      await seedTranslationClaimFile({
        projectId: project.id,
        taskId: translationOne.id,
        unitId: unit.id,
        userId: translatorOne.id,
        segmentStart: 0,
        segmentEnd: 100,
        status: "approved",
      });
      const translationTwo = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "submitted",
        assignee_id: translatorTwo.id,
        creator_id: owner.id,
        translation_order: 2,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "pending_publish",
        creator_id: owner.id,
      });

      await seedTranslationClaimFile({
        projectId: project.id,
        taskId: translationTwo.id,
        unitId: unit.id,
        userId: translatorTwo.id,
        segmentStart: 100,
        segmentEnd: 200,
        status: "submitted",
      });

      const approveRes = await post(
        app,
        `/api/v1/tasks/${translationTwo.id}/approve`,
        { approved: true, comments: "OK" },
        ownerToken
      );

      expectSuccess(approveRes, 200);

      const completedTranslations = await prisma.task.findMany({
        where: { id: { in: [translationOne.id, translationTwo.id] } },
        orderBy: { translation_order: "asc" },
      });
      const unlockedDownstream = await prisma.task.findUnique({ where: { id: downstream.id } });
      expect(completedTranslations.map((task) => task.status)).toEqual(["completed", "completed"]);
      expect(unlockedDownstream!.status).toBe("claimable");
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
        if (role === "translation") {
          await seedTranslationClaimFile({
            projectId: project.id,
            taskId: task.id,
            unitId: unit.id,
            userId: worker.id,
          });
        }

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

    it("should prevent assignees from approving or rejecting their own submitted tasks", async () => {
      const { user: owner } = await createTestUser();
      const { user: worker, token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "submitted",
        assignee_id: worker.id,
        creator_id: owner.id,
      });

      const approveRes = await post(
        app,
        `/api/v1/tasks/${task.id}/approve`,
        { approved: true, comments: "self approve" },
        workerToken
      );
      const rejectRes = await post(
        app,
        `/api/v1/tasks/${task.id}/reject`,
        { approved: false, comments: "self reject" },
        workerToken
      );

      expectError(approveRes, 403, "FORBIDDEN");
      expectError(rejectRes, 403, "FORBIDDEN");
      expect(await prisma.review.count({ where: { task_id: task.id } })).toBe(0);
      const unchanged = await prisma.task.findUnique({ where: { id: task.id } });
      expect(unchanged!.status).toBe("submitted");
    });
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

    it("should cascade reset downstream tasks when an upstream task is manually reset", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "completed",
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
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
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });
      await prisma.taskDependency.create({
        data: {
          task_id: releaseTask.id,
          depends_on_id: downstream.id,
          dependency_type: "finish_to_start",
        },
      });

      const resetRes = await post(
        app,
        `/api/v1/tasks/${upstream.id}/reset`,
        { reason: "Upstream source changed" },
        ownerToken
      );

      expectSuccess(resetRes, 200);

      const resetUpstream = await prisma.task.findUnique({ where: { id: upstream.id } });
      const resetDownstream = await prisma.task.findUnique({ where: { id: downstream.id } });
      const resetRelease = await prisma.task.findUnique({ where: { id: releaseTask.id } });

      expect(resetUpstream!.status).toBe("in_progress");
      expect(resetDownstream!.status).toBe("in_progress");
      expect(resetRelease!.status).toBe("pending_publish");
    });

    it("should allow supervisors to reset in-progress tasks and active downstream tasks", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: worker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: worker.id,
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "review_rejected",
        assignee_id: worker.id,
        creator_id: owner.id,
      });

      await prisma.taskDependency.create({
        data: {
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });

      const resetRes = await post(
        app,
        `/api/v1/tasks/${upstream.id}/reset`,
        { reason: "Restart active work" },
        ownerToken
      );

      expectSuccess(resetRes, 200);

      const resetUpstream = await prisma.task.findUnique({ where: { id: upstream.id } });
      const resetDownstream = await prisma.task.findUnique({ where: { id: downstream.id } });

      expect(resetUpstream!.status).toBe("in_progress");
      expect(resetUpstream!.started_at).not.toBeNull();
      expect(resetDownstream!.status).toBe("in_progress");
      expect(resetDownstream!.submitted_at).toBeNull();
    });

    it("should reopen approved translation claims when resetting completed translation tasks", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "completed",
        creator_id: owner.id,
        completed_at: new Date(),
      });
      const claim = await prisma.translationClaim.create({
        data: {
          task_id: task.id,
          unit_id: unit.id,
          user_id: translator.id,
          segment_start: 0,
          segment_end: 120,
          status: "approved",
          submitted_at: new Date("2026-01-01T00:00:00.000Z"),
          approved_at: new Date("2026-01-01T00:10:00.000Z"),
        },
      });
      const { version: oldVersion } = await createTestFile({
        project_id: project.id,
        uploader_id: translator.id,
        name: "translation_old.ass",
        metadata: JSON.stringify({ task_id: task.id, unit_id: unit.id, role: "translation" }),
      });
      await prisma.translationSubmission.create({
        data: {
          task_id: task.id,
          user_id: translator.id,
          claim_id: claim.id,
          file_version_id: oldVersion.id,
          content: "",
          line_count: null,
          submitted_at: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      const resetRes = await post(app, `/api/v1/tasks/${task.id}/reset`, { reason: "翻译返工" }, ownerToken);
      expectSuccess(resetRes, 200);

      const resetTask = await prisma.task.findUnique({ where: { id: task.id } });
      const resetClaim = await prisma.translationClaim.findUnique({ where: { id: claim.id } });
      expect(resetTask!.status).toBe("in_progress");
      expect(resetTask!.assignee_id).toBe(translator.id);
      expect(resetClaim!.status).toBe("active");
      expect(resetClaim!.submitted_at).toBeNull();
      expect(resetClaim!.approved_at).toBeNull();

      const { version: newVersion } = await createTestFile({
        project_id: project.id,
        uploader_id: translator.id,
        name: "translation_new.ass",
        metadata: JSON.stringify({ task_id: task.id, unit_id: unit.id, role: "translation" }),
      });
      await prisma.fileVersion.update({
        where: { id: oldVersion.id },
        data: { created_at: new Date("2026-01-01T00:00:00.000Z") },
      });
      await prisma.fileVersion.update({
        where: { id: newVersion.id },
        data: { created_at: new Date("2026-01-01T01:00:00.000Z") },
      });

      const submitRes = await post(app, `/api/v1/tasks/${task.id}/submit`, {}, translatorToken);
      expectSuccess(submitRes, 200);

      const updatedSubmission = await prisma.translationSubmission.findFirst({
        where: { claim_id: claim.id },
        orderBy: { submitted_at: "desc" },
      });
      expect(updatedSubmission!.file_version_id).toBe(newVersion.id);
    });

    it("should prevent non-supervisors from manually resetting project tasks", async () => {
      const { user: owner } = await createTestUser();
      const { token: workerToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "completed",
        creator_id: owner.id,
      });

      const resetRes = await post(
        app,
        `/api/v1/tasks/${task.id}/reset`,
        { reason: "Trying to reset" },
        workerToken
      );

      expectError(resetRes, 403, "FORBIDDEN");
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
