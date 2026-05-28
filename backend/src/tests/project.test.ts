import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestTemplate,
  createTestUnit,
  createTestTask,
  cleanDatabase,
} from "./setup";
import { post, get, put, del, expectSuccess, expectError } from "./helpers";
import type { Application } from "express";

describe("Project & Workflow Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
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

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Templated Project",
          template_id: template.id,
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
      const templateChecklist = JSON.parse(project!.template!.delivery_checklist);
      expect(templateChecklist).toEqual(checklist);
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

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Product Config Project",
          template_id: template.id,
          season_count: 1,
          units_per_season: 1,
        },
        token
      );

      expectSuccess(res, 201);

      const project = await prisma.project.findUnique({
        where: { id: res.body.data.id },
        include: { template: true },
      });

      const config = JSON.parse(project!.template!.product_config);
      expect(config.resolutions).toEqual(["1080p", "720p"]);
      expect(config.codecs).toEqual(["h264", "hevc"]);
    });

    it("should create tasks for each unit based on template roles", async () => {
      const { user, token } = await createTestUser();
      const template = await createTestTemplate({
        roles: [
          { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "translation", enabled: true, slotCount: 2, assignmentStrategy: "open_claim", maxSegmentsPerUser: 3 },
          { role: "encoding", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "release", enabled: false, slotCount: 1, assignmentStrategy: "manual" },
        ],
      });

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Multi-Unit Project",
          template_id: template.id,
          season_count: 1,
          units_per_season: 3,
        },
        token
      );

      expectSuccess(res, 201);

      const tasks = await prisma.task.findMany({
        where: { project_id: res.body.data.id },
      });

      // 3 units * 3 enabled roles (source=1, translation=2, encoding=1) = 12 tasks
      expect(tasks.length).toBe(12);

      // Check translation tasks are claimable
      const translationTasks = tasks.filter((t) => t.role === "translation");
      expect(translationTasks.length).toBe(6); // 3 units * 2 slots
      expect(translationTasks.every((t) => t.status === "claimable")).toBe(true);

      // Check source tasks are pending_publish
      const sourceTasks = tasks.filter((t) => t.role === "source");
      expect(sourceTasks.every((t) => t.status === "pending_publish")).toBe(true);

      // No release tasks since disabled
      const releaseTasks = tasks.filter((t) => t.role === "release");
      expect(releaseTasks.length).toBe(0);
    });

    it("should create serial dependencies between tasks", async () => {
      const { user, token } = await createTestUser();
      const template = await createTestTemplate({
        roles: [
          { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
          { role: "translation", enabled: true, slotCount: 1, assignmentStrategy: "open_claim" },
        ],
      });

      const res = await post(
        app,
        "/api/v1/projects/from-template",
        {
          name: "Dependency Project",
          template_id: template.id,
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

      // 1 unit * 3 roles = 3 tasks, with 2 dependencies (serial chain)
      expect(dependencies.length).toBe(2);
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

      await prisma.taskDependency.create({
        data: {
          task_id: task2.id,
          depends_on_id: task1.id,
          dependency_type: "finish_to_start",
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
    });
  });
});
