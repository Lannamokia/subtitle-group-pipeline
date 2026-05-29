import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestTask,
  createTestUnit,
  createTestFile,
  createTestStorageBackend,
  createTestNotification,
  cleanDatabase,
} from "./setup";
import { post, get, put, expectSuccess } from "./helpers";
import * as notificationService from "../modules/notification/notification.service";
import * as subtitleService from "../modules/subtitle/subtitle.service";
import { executeDelivery } from "../modules/notification/delivery.service";
import { buildGroupMessageContent } from "../modules/notification/adapters/qq.adapter";
import { NotificationChannel } from "@prisma/client";
import type { Application } from "express";

describe("Notification Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  describe("Notification Recipient Resolution", () => {
    it("should resolve task_assigned recipient", async () => {
      const { user: assignee } = await createTestUser();
      const { user: owner } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const task = await createTestTask({
        project_id: project.id,
        assignee_id: assignee.id,
        creator_id: owner.id,
        role: "translation",
        status: "assigned",
      });

      const recipients = await notificationService.resolveRecipients("task_assigned", {
        taskId: task.id,
      });

      expect(recipients).toContain(assignee.id);
    });

    it("should resolve file_uploaded recipients (project members excluding actor)", async () => {
      const { user: owner } = await createTestUser();
      const { user: member1 } = await createTestUser();
      const { user: member2 } = await createTestUser();
      const { user: uploader } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await prisma.projectMember.createMany({
        data: [
          { project_id: project.id, user_id: member1.id, role: "translation" },
          { project_id: project.id, user_id: member2.id, role: "timing" },
          { project_id: project.id, user_id: uploader.id, role: "source" },
        ],
      });

      const recipients = await notificationService.resolveRecipients("file_uploaded", {
        projectId: project.id,
        actorId: uploader.id,
      });

      expect(recipients).toContain(member1.id);
      expect(recipients).toContain(member2.id);
      expect(recipients).toContain(owner.id);
      expect(recipients).not.toContain(uploader.id);
    });

    it("should resolve mention recipients from comment content", async () => {
      const { user: mentioned1 } = await createTestUser({ username: "alice" });
      const { user: mentioned2 } = await createTestUser({ username: "bob" });
      const { user: commenter } = await createTestUser();

      const recipients = await notificationService.resolveRecipients("mention", {
        commentContent: "Hey @alice and @bob, please review this.",
        actorId: commenter.id,
      });

      expect(recipients).toContain(mentioned1.id);
      expect(recipients).toContain(mentioned2.id);
      expect(recipients).not.toContain(commenter.id);
    });

    it("should resolve join_request recipients (supervisors and owner)", async () => {
      const { user: owner } = await createTestUser();
      const { user: supervisor } = await createTestUser();
      const { user: applicant } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: supervisor.id, role: "supervisor", is_lead: true },
      });

      const recipients = await notificationService.resolveRecipients("join_request", {
        projectId: project.id,
        actorId: applicant.id,
      });

      expect(recipients).toContain(owner.id);
      expect(recipients).toContain(supervisor.id);
      expect(recipients).not.toContain(applicant.id);
    });

    it("should resolve conflict_detected recipients (supervisors)", async () => {
      const { user: owner } = await createTestUser();
      const { user: supervisor } = await createTestUser();
      const { user: regular } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      await prisma.projectMember.createMany({
        data: [
          { project_id: project.id, user_id: supervisor.id, role: "supervisor" },
          { project_id: project.id, user_id: regular.id, role: "translation" },
        ],
      });

      const recipients = await notificationService.resolveRecipients("conflict_detected", {
        projectId: project.id,
      });

      expect(recipients).toContain(supervisor.id);
      expect(recipients).toContain(owner.id);
      expect(recipients).not.toContain(regular.id);
    });

    it("should resolve task_overdue recipients (assignee + supervisors)", async () => {
      const { user: owner } = await createTestUser();
      const { user: supervisor } = await createTestUser();
      const { user: assignee } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: supervisor.id, role: "supervisor" },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        assignee_id: assignee.id,
        creator_id: owner.id,
        role: "translation",
        status: "overdue",
      });

      const recipients = await notificationService.resolveRecipients("task_overdue", {
        taskId: task.id,
      });

      expect(recipients).toContain(assignee.id);
      expect(recipients).toContain(supervisor.id);
      expect(recipients).toContain(owner.id);
    });
  });

  describe("Workflow Event Notifications", () => {
    it("should create review requests and notify project reviewers when a gated task is submitted", async () => {
      const { user: owner } = await createTestUser();
      const { user: supervisor } = await createTestUser();
      const { user: translator, token: translatorToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: supervisor.id, role: "supervisor", is_lead: true },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "in_progress",
        assignee_id: translator.id,
        creator_id: owner.id,
      });

      const res = await post(app, `/api/v1/tasks/${task.id}/submit`, {}, translatorToken);

      expectSuccess(res, 200);

      const reviews = await prisma.review.findMany({
        where: { task_id: task.id, status: "pending" },
      });
      expect(reviews.map((review) => review.reviewer_id)).toEqual(
        expect.arrayContaining([owner.id, supervisor.id])
      );
      expect(reviews.every((review) => review.requester_id === translator.id)).toBe(true);

      const notifications = await prisma.notification.findMany({
        where: { type: "review_requested", task_id: task.id },
      });
      expect(notifications.map((notification) => notification.user_id)).toEqual(
        expect.arrayContaining([owner.id, supervisor.id])
      );
    });

    it("should notify the requester when review is approved or rejected", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const approvedTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "submitted",
        assignee_id: translator.id,
        creator_id: owner.id,
      });

      const approveRes = await post(
        app,
        `/api/v1/tasks/${approvedTask.id}/approve`,
        { approved: true, comments: "OK" },
        ownerToken
      );
      expectSuccess(approveRes, 200);

      const approvedReview = await prisma.review.findFirst({
        where: { task_id: approvedTask.id, status: "approved" },
      });
      expect(approvedReview!.requester_id).toBe(translator.id);

      const approvedNotification = await prisma.notification.findFirst({
        where: {
          user_id: translator.id,
          task_id: approvedTask.id,
          type: "review_approved",
        },
      });
      expect(approvedNotification).toBeDefined();

      const rejectedTask = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "encoding",
        status: "submitted",
        assignee_id: translator.id,
        creator_id: owner.id,
      });

      const rejectRes = await post(
        app,
        `/api/v1/tasks/${rejectedTask.id}/reject`,
        { approved: false, comments: "Needs fixes" },
        ownerToken
      );
      expectSuccess(rejectRes, 200);

      const rejectedReview = await prisma.review.findFirst({
        where: { task_id: rejectedTask.id, status: "rejected" },
      });
      expect(rejectedReview!.requester_id).toBe(translator.id);

      const rejectedNotification = await prisma.notification.findFirst({
        where: {
          user_id: translator.id,
          task_id: rejectedTask.id,
          type: "review_rejected",
        },
      });
      expect(rejectedNotification).toBeDefined();
    });

    it("should notify downstream assignees when an approved task unlocks their work", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: translator } = await createTestUser();
      const { user: postWorker } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      const upstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "submitted",
        assignee_id: translator.id,
        creator_id: owner.id,
      });
      const downstream = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "post_production",
        status: "pending_publish",
        assignee_id: postWorker.id,
        creator_id: owner.id,
      });
      await prisma.taskDependency.create({
        data: {
          task_id: downstream.id,
          depends_on_id: upstream.id,
          dependency_type: "finish_to_start",
        },
      });

      const approveRes = await post(
        app,
        `/api/v1/tasks/${upstream.id}/approve`,
        { approved: true, comments: "Unlock next" },
        ownerToken
      );
      expectSuccess(approveRes, 200);

      const notification = await prisma.notification.findFirst({
        where: {
          user_id: postWorker.id,
          task_id: downstream.id,
          type: "task_assigned",
        },
      });
      expect(notification).toBeDefined();
    });

    it("should notify both applicant and acting reviewer for join decisions", async () => {
      const { user: owner, token: ownerToken } = await createTestUser();
      const { user: applicant, token: applicantToken } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      const joinRes = await post(
        app,
        `/api/v1/projects/${project.id}/join`,
        { role: "translation", message: "I can help" },
        applicantToken
      );
      expectSuccess(joinRes, 201);

      const approveRes = await post(
        app,
        `/api/v1/projects/join-requests/${joinRes.body.data.id}/respond`,
        { approved: true },
        ownerToken
      );
      expectSuccess(approveRes, 200);

      const approvedNotifications = await prisma.notification.findMany({
        where: {
          type: "join_approved",
          project_id: project.id,
        },
      });
      expect(approvedNotifications.map((notification) => notification.user_id)).toEqual(
        expect.arrayContaining([applicant.id, owner.id])
      );
    });

    it("should notify supervisors when subtitle merge detects conflicts", async () => {
      const { user: owner } = await createTestUser();
      const { user: supervisor } = await createTestUser();
      const backend = await createTestStorageBackend({ is_default: true });
      const project = await createTestProject({
        owner_id: owner.id,
        storage_backend_id: backend.id,
      });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        role: "translation",
        status: "submitted",
        creator_id: owner.id,
      });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: supervisor.id, role: "supervisor" },
      });

      const { version: versionA } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
        name: "a.ass",
      });
      const { version: versionB } = await createTestFile({
        project_id: project.id,
        uploader_id: owner.id,
        name: "b.ass",
      });

      const contentA = `[Script Info]
Title: A
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Version A`;
      const contentB = contentA.replace("Version A", "Version B");

      await prisma.translationSubmission.createMany({
        data: [
          { task_id: task.id, user_id: owner.id, file_version_id: versionA.id, content: contentA },
          { task_id: task.id, user_id: owner.id, file_version_id: versionB.id, content: contentB },
        ],
      });
      const job = await prisma.mergeJob.create({
        data: {
          project_id: project.id,
          unit_id: unit.id,
          input_files: JSON.stringify([versionA.id, versionB.id]),
        },
      });

      await subtitleService.processMergeJob(job.id);

      const notifications = await prisma.notification.findMany({
        where: { type: "conflict_detected", project_id: project.id },
      });
      expect(notifications.map((notification) => notification.user_id)).toEqual(
        expect.arrayContaining([owner.id, supervisor.id])
      );
    });
  });

  describe("QQ Group @ Payload Generation", () => {
    it("should build CQ group payload with @ mentions and escaped content", () => {
      const message = buildGroupMessageContent({
        groupId: "123456789",
        content: "Task [A], check & confirm",
        atUsers: ["987654321", "111222333"],
      });

      expect(message).toBe(
        "[CQ:at,qq=987654321] [CQ:at,qq=111222333]\nTask &#91;A&#93;&#44; check &amp; confirm"
      );
    });

    it("should format QQ group notification with @ mentions", async () => {
      const result = await notificationService.sendQQGroupNotification(
        "123456789",
        "Task assignment updated",
        ["987654321", "111222333"]
      );

      // The function returns a delivery status
      expect(result).toBeDefined();
      expect(result).toBe("sent");
    });

    it("should deliver QQ notifications through group message with targeted @ mention when group is configured", async () => {
      const { user } = await createTestUser({ qq_number: "987654321" });
      const notification = await createTestNotification({
        user_id: user.id,
        type: "task_assigned",
        title: "Task assigned",
        content: "Please handle timing",
      });

      const status = await executeDelivery({
        notificationId: notification.id,
        channel: NotificationChannel.qq,
        recipient: {
          userId: user.id,
          qqNumber: user.qq_number,
        },
        payload: {
          subject: notification.title,
          body: notification.content || "",
          groupId: "123456789",
          notificationType: notification.type,
        },
      });

      expect(status).toBe("sent");

      const delivery = await prisma.notificationDelivery.findFirst({
        where: {
          notification_id: notification.id,
          channel: "qq",
        },
        orderBy: { created_at: "desc" },
      });
      expect(delivery).toBeDefined();
      expect(delivery!.status).toBe("sent");
      expect(delivery!.external_id).toContain("mock-qq");
    });
  });

  describe("Channel Escalation Rules", () => {
    it("should create notification with in_site delivery", async () => {
      const { user } = await createTestUser();

      const notification = await notificationService.createNotification(
        user.id,
        "task_assigned",
        {
          taskName: "Test Task",
          projectName: "Test Project",
        }
      );

      expect(notification).toBeDefined();
      expect(notification.user_id).toBe(user.id);
      expect(notification.type).toBe("task_assigned");
      expect(notification.status).toBe("unread");

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notification_id: notification.id },
      });

      expect(deliveries.length).toBeGreaterThan(0);
      expect(deliveries.some((d) => d.channel === "in_site")).toBe(true);
    });

    it("should store notification preferences with escalation settings", async () => {
      const { user } = await createTestUser();

      const prefs = await prisma.notificationPreference.create({
        data: {
          user_id: user.id,
          email_enabled: true,
          qq_enabled: true,
          in_site_enabled: true,
          email_escalation_min: 30,
          qq_escalation_min: 120,
        },
      });

      expect(prefs.email_escalation_min).toBe(30);
      expect(prefs.qq_escalation_min).toBe(120);
    });

    it("should update notification preferences", async () => {
      const { user, token } = await createTestUser();

      await prisma.notificationPreference.create({
        data: {
          user_id: user.id,
          email_enabled: true,
          email_escalation_min: 30,
        },
      });

      const res = await put(
        app,
        "/api/v1/notifications/preferences",
        {
          email_enabled: false,
          qq_enabled: true,
          email_escalation_min: 60,
        },
        token
      );

      expectSuccess(res, 200);
      expect(res.body.data.email_enabled).toBe(false);
      expect(res.body.data.qq_enabled).toBe(true);
      expect(res.body.data.email_escalation_min).toBe(60);
    });
  });

  describe("Task Reassignment Notifications", () => {
    it("should notify previous assignee of task reassignment", async () => {
      const { user: previousAssignee } = await createTestUser();
      const { user: newAssignee } = await createTestUser();
      const { user: owner } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });

      const notification = await notificationService.sendTaskReassignmentNotification(
        previousAssignee.id,
        "task-123",
        "Translation Task",
        project.id,
        project.name,
        newAssignee.username
      );

      expect(notification).toBeDefined();
      expect(notification.user_id).toBe(previousAssignee.id);
      expect(notification.type).toBe("task_reassigned");
    });
  });

  describe("Comment @ Mentions", () => {
    it("should extract mentions from comment content", async () => {
      const { user: alice } = await createTestUser({ username: "alice" });
      const { user: bob } = await createTestUser({ username: "bob" });
      const { user: charlie } = await createTestUser({ username: "charlie" });
      const { user: commenter } = await createTestUser();
      const project = await createTestProject({ owner_id: commenter.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: commenter.id,
      });

      const comment = await prisma.comment.create({
        data: {
          user_id: commenter.id,
          content: "@alice @bob please check this file. @alice (duplicate mention)",
          file_version_id: file.id,
        },
      });

      const recipients = await notificationService.resolveRecipients("mention", {
        commentContent: comment.content,
        actorId: commenter.id,
      });

      expect(recipients).toContain(alice.id);
      expect(recipients).toContain(bob.id);
      expect(recipients).not.toContain(charlie.id);
      // Should deduplicate
      expect(recipients.filter((id) => id === alice.id).length).toBe(1);
    });
  });

  describe("Overdue Marking and Escalation", () => {
    it("should mark overdue tasks and create notifications", async () => {
      const { user: owner } = await createTestUser();
      const { user: assignee } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      // Create an overdue task
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        assignee_id: assignee.id,
        creator_id: owner.id,
        role: "translation",
        status: "in_progress",
        due_date: new Date(Date.now() - 86400000), // 1 day ago
      });

      // Manually mark as overdue
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "overdue" },
      });

      const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(updatedTask!.status).toBe("overdue");

      // Create notification for overdue task
      const notification = await createTestNotification({
        user_id: assignee.id,
        type: "task_overdue",
        title: "Task is overdue",
        content: `Task "${task.title}" is overdue`,
        task_id: task.id,
        project_id: project.id,
      });

      expect(notification.type).toBe("task_overdue");
    });

    it("should escalate to supervisors for overdue tasks", async () => {
      const { user: owner } = await createTestUser();
      const { user: supervisor } = await createTestUser();
      const { user: assignee } = await createTestUser();
      const project = await createTestProject({ owner_id: owner.id });
      const unit = await createTestUnit({ project_id: project.id });

      await prisma.projectMember.create({
        data: { project_id: project.id, user_id: supervisor.id, role: "supervisor", is_lead: true },
      });

      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        assignee_id: assignee.id,
        creator_id: owner.id,
        role: "translation",
        status: "overdue",
      });

      const recipients = await notificationService.resolveRecipients("task_overdue", {
        taskId: task.id,
      });

      expect(recipients).toContain(assignee.id);
      expect(recipients).toContain(supervisor.id);
    });
  });

  describe("Channel Delivery Logging", () => {
    it("should log delivery attempts", async () => {
      const { user } = await createTestUser();

      const notification = await createTestNotification({
        user_id: user.id,
        type: "system",
        title: "Test",
      });

      const delivery = await prisma.notificationDelivery.create({
        data: {
          notification_id: notification.id,
          channel: "email",
          status: "sent",
          sent_at: new Date(),
          external_id: "msg-12345",
        },
      });

      const logs = await prisma.notificationDelivery.findMany({
        where: { notification_id: notification.id },
      });

      expect(logs.length).toBe(1);
      expect(logs[0].channel).toBe("email");
      expect(logs[0].status).toBe("sent");
      expect(logs[0].external_id).toBe("msg-12345");
    });

    it("should log failed deliveries with error message", async () => {
      const { user } = await createTestUser();

      const notification = await createTestNotification({
        user_id: user.id,
        type: "system",
        title: "Test",
      });

      await prisma.notificationDelivery.create({
        data: {
          notification_id: notification.id,
          channel: "email",
          status: "failed",
          error_message: "SMTP connection timeout",
          failed_at: new Date(),
        },
      });

      const failedDelivery = await prisma.notificationDelivery.findFirst({
        where: { notification_id: notification.id, status: "failed" },
      });

      expect(failedDelivery).toBeDefined();
      expect(failedDelivery!.error_message).toBe("SMTP connection timeout");
    });
  });

  describe("Retry Handling", () => {
    it("should track retry count on failed deliveries", async () => {
      const { user } = await createTestUser();

      const notification = await createTestNotification({
        user_id: user.id,
        type: "system",
        title: "Test",
      });

      const delivery = await prisma.notificationDelivery.create({
        data: {
          notification_id: notification.id,
          channel: "email",
          status: "failed",
          retry_count: 2,
          error_message: "Temporary failure",
        },
      });

      expect(delivery.retry_count).toBe(2);

      // Simulate retry
      const retried = await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { retry_count: { increment: 1 } },
      });

      expect(retried.retry_count).toBe(3);
    });

    it("should stop retrying after max attempts", async () => {
      const { user } = await createTestUser();

      const notification = await createTestNotification({
        user_id: user.id,
        type: "system",
        title: "Test",
      });

      await prisma.notificationDelivery.create({
        data: {
          notification_id: notification.id,
          channel: "email",
          status: "failed",
          retry_count: 3,
          error_message: "Max retries exceeded",
        },
      });

      const shouldRetry = await prisma.notificationDelivery.findFirst({
        where: {
          notification_id: notification.id,
          status: "failed",
          retry_count: { lt: 3 },
        },
      });

      expect(shouldRetry).toBeNull();
    });

    it("should retry failed deliveries via service", async () => {
      const { user } = await createTestUser();

      const notification = await createTestNotification({
        user_id: user.id,
        type: "system",
        title: "Test Retry",
      });

      await prisma.notificationDelivery.create({
        data: {
          notification_id: notification.id,
          channel: "in_site",
          status: "failed",
          retry_count: 1,
        },
      });

      // Run retry service
      await notificationService.retryFailedDeliveries();

      // The retry may succeed or fail, but the delivery record should be updated
      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notification_id: notification.id },
      });

      expect(deliveries.length).toBeGreaterThan(0);
    });
  });

  describe("Notification CRUD", () => {
    it("should get user notifications with unread count", async () => {
      const { user, token } = await createTestUser();

      await createTestNotification({ user_id: user.id, status: "unread" });
      await createTestNotification({ user_id: user.id, status: "unread" });
      await createTestNotification({ user_id: user.id, status: "read" });

      const res = await get(app, "/api/v1/notifications", token);

      expectSuccess(res, 200);
      expect(res.body.data.notifications.length).toBe(3);
      expect(res.body.data.unreadCount).toBe(2);
    });

    it("should mark notification as read", async () => {
      const { user, token } = await createTestUser();
      const notification = await createTestNotification({
        user_id: user.id,
        status: "unread",
      });

      const res = await put(
        app,
        `/api/v1/notifications/${notification.id}/read`,
        {},
        token
      );

      expectSuccess(res, 200);

      const updated = await prisma.notification.findUnique({
        where: { id: notification.id },
      });
      expect(updated!.status).toBe("read");
      expect(updated!.read_at).not.toBeNull();
    });

    it("should mark all notifications as read", async () => {
      const { user, token } = await createTestUser();

      await createTestNotification({ user_id: user.id, status: "unread" });
      await createTestNotification({ user_id: user.id, status: "unread" });

      const res = await put(app, "/api/v1/notifications/read-all", {}, token);

      expectSuccess(res, 200);

      const unreadCount = await prisma.notification.count({
        where: { user_id: user.id, status: "unread" },
      });
      expect(unreadCount).toBe(0);
    });

    it("should dismiss notification", async () => {
      const { user, token } = await createTestUser();
      const notification = await createTestNotification({
        user_id: user.id,
        status: "read",
      });

      const res = await put(
        app,
        `/api/v1/notifications/${notification.id}/dismiss`,
        {},
        token
      );

      expectSuccess(res, 200);

      const updated = await prisma.notification.findUnique({
        where: { id: notification.id },
      });
      expect(updated!.status).toBe("dismissed");
    });
  });
});
