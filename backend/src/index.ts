import { createApp } from "./app";
import { env } from "./config/env";
import { canConnectDatabase, prisma } from "./config/database";
import { registerAllJobs, scheduler } from "./jobs";
import { upgradeConfiguredDatabaseSchema } from "./modules/setup/setup.service";
import { setupState } from "./modules/setup/setup.state";

const PORT = env.PORT;
const LARGE_FILE_UPLOAD_TIMEOUT_MS = 12 * 60 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function startServer(): Promise<void> {
  let databaseReady = false;
  let databaseUpgradeFailed = false;

  if (env.DATABASE_AUTO_UPGRADE) {
    try {
      const result = await upgradeConfiguredDatabaseSchema();
      if (!result.skipped) {
        console.log(`Database schema synchronized (${result.provider})`);
      }
    } catch (error) {
      databaseUpgradeFailed = true;
      console.error(`Database auto-upgrade failed: ${errorMessage(error)}`);
      console.log("Database unavailable; setup mode enabled");
    }
  }

  if (!databaseUpgradeFailed) {
    try {
      databaseReady = await canConnectDatabase();
      console.log(databaseReady ? "Connected to database" : "Database unavailable; setup mode enabled");
    } catch {
      databaseReady = false;
      console.log("Database unavailable; setup mode enabled");
    }
  }
  setupState.databaseReady = databaseReady;

  try {
    const app = createApp({ databaseReady });
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${env.NODE_ENV}`);
      console.log(`API prefix: ${env.API_PREFIX}`);
    });
    server.requestTimeout = LARGE_FILE_UPLOAD_TIMEOUT_MS;
    server.setTimeout(LARGE_FILE_UPLOAD_TIMEOUT_MS);

    if (databaseReady) {
      registerAllJobs();
      scheduler.start();
    }

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      console.log(`\n${signal} received. Shutting down gracefully...`);

      // Stop all background jobs first
      await scheduler.stopGracefully();

      server.close(async () => {
        await prisma.$disconnect();
        console.log("Database connection closed");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to start server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

startServer();
