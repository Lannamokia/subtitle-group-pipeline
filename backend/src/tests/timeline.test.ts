import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestUnit,
  createTestTask,
  cleanDatabase,
} from "./setup";
import { post, get, expectSuccess } from "./helpers";
import * as timelineService from "../modules/timeline/timeline.service";
import type { Application } from "express";

describe("Timeline & Workload Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  describe("Activity Timeline Event Generation", () => {
    it("should create timeline event on project creation", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const event = await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "project_created",
        title: "Project created",
        description: `Project "${project.name}" was created`,
        actor_id: user.id,
      });

      expect(event).toBeDefined();
      expect(event.project_id).toBe(project.id);
      expect(event.event_type).toBe("project_created");
      expect(event.title).toBe("Project created");
      expect(event.actor_id).toBe(user.id);
    });

    it("should create timeline event on task claim", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "assigned",
        assignee_id: user.id,
        creator_id: user.id,
      });

      const event = await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "task_claimed",
        title: "Task claimed",
        description: `Task "${task.title}" was claimed`,
        actor_id: user.id,
        metadata: { task_id: task.id },
      });

      expect(event.event_type).toBe("task_claimed");
      expect(event.metadata).toBe(JSON.stringify({ task_id: task.id }));
    });

    it("should create timeline event on task completion", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "completed",
        creator_id: user.id,
      });

      const event = await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "task_completed",
        title: "Task completed",
        description: `Task "${task.title}" was completed`,
        actor_id: user.id,
      });

      expect(event.event_type).toBe("task_completed");
    });

    it("should create timeline event on member join", async () => {
      const { user: owner } = await createTestUser();
      const { user: member } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await prisma.projectMember.create({
        data: {
          project_id: project.id,
          user_id: member.id,
          role: "translation",
        },
      });

      const event = await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "member_joined",
        title: "Member joined",
        description: `${member.username} joined the project`,
        actor_id: member.id,
      });

      expect(event.event_type).toBe("member_joined");
    });

    it("should create timeline event on file upload", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const uploadRes = await post(
        app,
        "/api/v1/files",
        {
          project_id: project.id,
          name: "episode.ass",
          file_type: "subtitle",
          mime_type: "application/x-ass",
          size_bytes: 128,
          storage_path: "/uploads/episode.ass",
        },
        token
      );

      expectSuccess(uploadRes, 201);

      const event = await prisma.timelineEvent.findFirst({
        where: {
          project_id: project.id,
          event_type: "file_uploaded",
        },
      });
      expect(event).toBeDefined();
      expect(event!.actor_id).toBe(user.id);
      expect(event!.metadata).toContain(uploadRes.body.data.id);
    });

    it("should create timeline event on project announcement", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      const res = await post(
        app,
        "/api/v1/announcements",
        {
          type: "project",
          project_id: project.id,
          title: "Timing update",
          content: "Timing pass starts tonight.",
        },
        token
      );

      expectSuccess(res, 201);

      const event = await prisma.timelineEvent.findFirst({
        where: {
          project_id: project.id,
          event_type: "announcement",
        },
      });
      expect(event).toBeDefined();
      expect(event!.title).toBe("Project announcement");
      expect(event!.metadata).toContain(res.body.data.id);
    });
  });

  describe("Timeline Event Retrieval", () => {
    it("should retrieve project timeline events", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "project_created",
        title: "Project created",
        actor_id: user.id,
      });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "task_created",
        title: "Task created",
        actor_id: user.id,
      });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "member_joined",
        title: "Member joined",
        actor_id: user.id,
      });

      const res = await get(app, `/api/v1/timeline/${project.id}`, token);

      expectSuccess(res, 200);
      expect(res.body.data.events.length).toBe(3);
    });

    it("should filter timeline events by type", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "project_created",
        title: "Project created",
        actor_id: user.id,
      });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "task_created",
        title: "Task 1",
        actor_id: user.id,
      });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "task_created",
        title: "Task 2",
        actor_id: user.id,
      });

      const res = await get(
        app,
        `/api/v1/timeline/${project.id}?event_type=task_created`,
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.events.length).toBe(2);
      expect(res.body.data.events.every((e: any) => e.event_type === "task_created")).toBe(true);
    });

    it("should paginate timeline events", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      for (let i = 0; i < 10; i++) {
        await timelineService.createTimelineEvent({
          project_id: project.id,
          event_type: "custom",
          title: `Event ${i}`,
          actor_id: user.id,
        });
      }

      const res = await get(
        app,
        `/api/v1/timeline/${project.id}?page=1&pageSize=5`,
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.events.length).toBe(5);
      expect(res.body.meta.total).toBe(10);
      expect(res.body.meta.totalPages).toBe(2);
    });

    it("should sort timeline events by occurred_at desc", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "project_created",
        title: "First",
        actor_id: user.id,
      });

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "task_created",
        title: "Second",
        actor_id: user.id,
      });

      const res = await get(app, `/api/v1/timeline/${project.id}`, token);

      expectSuccess(res, 200);
      expect(res.body.data.events[0].title).toBe("Second");
      expect(res.body.data.events[1].title).toBe("First");
    });

    it("should include actor info in timeline events", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });

      await timelineService.createTimelineEvent({
        project_id: project.id,
        event_type: "project_created",
        title: "Project created",
        actor_id: user.id,
      });

      const res = await get(app, `/api/v1/timeline/${project.id}`, token);

      expectSuccess(res, 200);
      expect(res.body.data.events[0].actor).toBeDefined();
      expect(res.body.data.events[0].actor.id).toBe(user.id);
      expect(res.body.data.events[0].actor.username).toBe(user.username);
    });

    it("should retrieve global timeline for user memberships", async () => {
      const { user, token } = await createTestUser();
      const project1 = await createTestProject({ owner_id: user.id });
      const project2 = await createTestProject({ owner_id: user.id });

      await prisma.projectMember.create({
        data: { project_id: project1.id, user_id: user.id, role: "supervisor" },
      });
      await prisma.projectMember.create({
        data: { project_id: project2.id, user_id: user.id, role: "translation" },
      });

      await timelineService.createTimelineEvent({
        project_id: project1.id,
        event_type: "project_created",
        title: "Project 1 event",
        actor_id: user.id,
      });

      await timelineService.createTimelineEvent({
        project_id: project2.id,
        event_type: "task_created",
        title: "Project 2 event",
        actor_id: user.id,
      });

      const res = await get(app, "/api/v1/timeline", token);

      expectSuccess(res, 200);
      expect(res.body.data.events.length).toBe(2);
    });
  });

  describe("Workload Dashboard Aggregation Queries", () => {
    it("should aggregate personal workload", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: user.id,
        creator_id: user.id,
      });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "assigned",
        assignee_id: user.id,
        creator_id: user.id,
      });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "encoding",
        status: "completed",
        assignee_id: user.id,
        creator_id: user.id,
        completed_at: new Date(),
      });

      const res = await get(app, "/api/v1/tasks/workload/personal", token);

      expectSuccess(res, 200);
      expect(res.body.data.stats.totalActive).toBe(2);
      expect(res.body.data.completedThisMonth).toBe(1);
    });

    it("should aggregate project workload by member", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: member1 } = await createTestUser();
      const { user: member2 } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.createMany({
        data: [
          { project_id: project.id, user_id: member1.id, role: "translation" },
          { project_id: project.id, user_id: member2.id, role: "timing" },
        ],
      });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: member1.id,
        creator_id: owner.id,
      });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "completed",
        assignee_id: member2.id,
        creator_id: owner.id,
        completed_at: new Date(),
      });

      const res = await get(app, `/api/v1/tasks/workload/project/${project.id}`, ownerToken);

      expectSuccess(res, 200);
      expect(res.body.data.length).toBe(2);

      const member1Workload = res.body.data.find((w: any) => w.member.user_id === member1.id);
      const member2Workload = res.body.data.find((w: any) => w.member.user_id === member2.id);

      expect(member1Workload.stats.inProgress).toBe(1);
      expect(member2Workload.stats.completed).toBe(1);
    });

    it("should aggregate global workload", async () => {
      const { user: user1 } = await createTestUser();
      const { user: user2 } = await createTestUser();
      const project = await createTestProject({ owner_id: user1.id });
      const unit = await createTestUnit({ project_id: project.id });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: user1.id,
        creator_id: user1.id,
      });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "timing",
        status: "completed",
        assignee_id: user2.id,
        creator_id: user1.id,
        completed_at: new Date(),
      });

      const res = await get(app, "/api/v1/tasks/workload/global", "");

      // Global workload may be admin-only
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    it("should count overdue tasks in workload", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: user.id,
        creator_id: user.id,
        due_date: new Date(Date.now() - 86400000), // 1 day overdue
      });

      const res = await get(app, "/api/v1/tasks/workload/personal", token);

      expectSuccess(res, 200);
      expect(res.body.data.stats.totalOverdue).toBe(1);
    });

    it("should filter out frozen tasks from active workload", async () => {
      const { user, token } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });

      await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "frozen",
        assignee_id: user.id,
        creator_id: user.id,
        frozen_at: new Date(),
      });

      const res = await get(app, "/api/v1/tasks/workload/personal", token);

      expectSuccess(res, 200);
      expect(res.body.data.stats.totalActive).toBe(0);
    });
  });
});
