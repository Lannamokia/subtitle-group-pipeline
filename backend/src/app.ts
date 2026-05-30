import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authenticate, requireRole } from "./middleware/auth";
import { validateBody, validateQuery, validateParams } from "./middleware/validate";
import { z } from "zod";

// Route imports
import authRoutes from "./modules/auth/auth.routes";
import projectRoutes from "./modules/project/project.routes";
import templateRoutes from "./modules/template/template.routes";
import taskRoutes from "./modules/task/task.routes";
import fileRoutes from "./modules/file/file.routes";
import notificationRoutes from "./modules/notification/notification.routes";
import subtitleRoutes from "./modules/subtitle/subtitle.routes";
import wikiRoutes from "./modules/wiki/wiki.routes";
import storageRoutes from "./modules/storage/storage.routes";
import announcementRoutes from "./modules/announcement/announcement.routes";
import timelineRoutes from "./modules/timeline/timeline.routes";
import qqRoutes from "./modules/qq/qq.routes";
import systemRoutes from "./modules/system/system.routes";
import setupRoutes from "./modules/setup/setup.routes";
import { setupState } from "./modules/setup/setup.state";
import { downloadByToken } from "./modules/file/file.controller";
import * as fileController from "./modules/file/file.controller";
import { createLinkSchema } from "./modules/file/file.schema";
import * as authController from "./modules/auth/auth.controller";
import {
  updateUserRoleSchema,
  updateUserStatusSchema,
  createMemberSchema,
  resetUserPasswordSchema,
  resetTagStatusSchema,
} from "./modules/auth/auth.schema";

export function createApp(options: { databaseReady?: boolean } = {}): Application {
  const app = express();
  setupState.databaseReady = options.databaseReady ?? setupState.databaseReady;

  // Security middleware
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );

  // Logging
  if (env.NODE_ENV === "development") {
    app.use(morgan("dev"));
  } else {
    app.use(morgan("combined"));
  }

  // Body parsing
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use(
    "/uploads/projects/avatars",
    express.static(path.resolve(env.UPLOAD_DIR, "projects", "avatars"), {
      setHeaders: (res) => {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    })
  );

  // Root redirect to frontend
  app.get("/", (_req, res) => {
    res.redirect(env.CORS_ORIGIN);
  });

  // Public download route (no auth required)
  app.get("/download/:token", downloadByToken);

  // NoneBot QQ verification webhook (public)
  app.post("/webhook/qq-verify", async (req, res, next) => {
    try {
      const { message, group_id } = req.body || {};
      if (!message || typeof message !== "string") {
        res.status(400).json({ success: false, error: "Missing message" });
        return;
      }
      const match = message.trim().match(/^\/verify\s+([A-Za-z0-9]+)$/);
      if (!match) {
        res.status(400).json({ success: false, error: "Invalid command format" });
        return;
      }
      const { verifyByQQ } = await import("./modules/auth/auth.service");
      const result = await verifyByQQ({
        code: match[1],
        qq_group: group_id === undefined || group_id === null ? undefined : String(group_id),
        qq_number:
          req.body?.user_id === undefined || req.body?.user_id === null
            ? undefined
            : String(req.body.user_id),
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // API routes
  const apiPrefix = env.API_PREFIX;
  app.use(`${apiPrefix}/setup`, setupRoutes);

  app.use(`${apiPrefix}`, (req, res, next) => {
    if (req.path.startsWith("/setup") || setupState.databaseReady) {
      next();
      return;
    }

    res.status(503).json({
      success: false,
      error: {
        code: "SETUP_REQUIRED",
        message: "Server is not initialized. Complete setup first.",
      },
    });
  });

  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/projects`, projectRoutes);
  app.use(`${apiPrefix}/templates`, templateRoutes);
  app.use(`${apiPrefix}/tasks`, taskRoutes);
  app.use(`${apiPrefix}/files`, fileRoutes);
  app.use(`${apiPrefix}/notifications`, notificationRoutes);
  app.use(`${apiPrefix}/subtitles`, subtitleRoutes);
  app.use(`${apiPrefix}/wiki`, wikiRoutes);
  app.use(`${apiPrefix}/storage`, storageRoutes);
  app.use(`${apiPrefix}/announcements`, announcementRoutes);
  app.use(`${apiPrefix}/timeline`, timelineRoutes);
  app.use(`${apiPrefix}/qq`, qqRoutes);
  app.use(`${apiPrefix}/system`, systemRoutes);

  // Compatibility aliases for frontend callers that use root-level member URLs.
  app.get(`${apiPrefix}/members`, authenticate, authController.getAllUsers);
  app.get(`${apiPrefix}/users`, authenticate, authController.getAllUsers);
  app.post(
    `${apiPrefix}/members`,
    authenticate,
    requireRole("super_admin", "group_admin", "supervisor"),
    validateBody(createMemberSchema),
    authController.createMember
  );
  app.put(
    `${apiPrefix}/members/:id/role`,
    authenticate,
    requireRole("super_admin", "group_admin"),
    validateBody(updateUserRoleSchema),
    authController.updateUserRole
  );
  app.put(
    `${apiPrefix}/members/:id/status`,
    authenticate,
    requireRole("super_admin", "group_admin"),
    validateBody(updateUserStatusSchema),
    authController.updateUserStatus
  );
  app.post(
    `${apiPrefix}/members/:id/verify`,
    authenticate,
    requireRole("super_admin", "group_admin"),
    authController.approveUserVerification
  );
  app.get(
    `${apiPrefix}/members/:id/tags/statuses`,
    authenticate,
    requireRole("super_admin", "group_admin"),
    authController.getMemberRoleTagStatuses
  );
  app.put(
    `${apiPrefix}/members/:id/password`,
    authenticate,
    requireRole("super_admin", "group_admin"),
    validateBody(resetUserPasswordSchema),
    authController.resetUserPassword
  );
  app.post(
    `${apiPrefix}/members/:id/tags/reset`,
    authenticate,
    requireRole("super_admin", "group_admin"),
    validateBody(resetTagStatusSchema),
    authController.resetMemberTagStatuses
  );
  app.delete(
    `${apiPrefix}/members/:id`,
    authenticate,
    requireRole("super_admin", "group_admin"),
    authController.deleteMember
  );
  app.get(
    `${apiPrefix}/links`,
    authenticate,
    validateQuery(z.object({
      project_id: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
    })),
    fileController.getLinks
  );
  app.post(
    `${apiPrefix}/links`,
    authenticate,
    validateBody(createLinkSchema),
    fileController.createLink
  );
  app.delete(
    `${apiPrefix}/links/:linkId`,
    authenticate,
    validateParams(z.object({ linkId: z.string().uuid("Invalid link ID") })),
    fileController.deleteLink
  );

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler
  app.use(errorHandler);

  return app;
}
