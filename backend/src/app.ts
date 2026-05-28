import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

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

export function createApp(): Application {
  const app = express();

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

  // API routes
  const apiPrefix = env.API_PREFIX;
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

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler
  app.use(errorHandler);

  return app;
}
