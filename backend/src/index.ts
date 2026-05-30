import { createApp } from "./app";
import { env } from "./config/env";
import { canConnectDatabase, prisma } from "./config/database";
import { registerAllJobs, scheduler } from "./jobs";
import { setupState } from "./modules/setup/setup.state";

const PORT = env.PORT;

async function startServer(): Promise<void> {
  let databaseReady = false;

  try {
    databaseReady = await canConnectDatabase();
    console.log(databaseReady ? "Connected to database" : "Database unavailable; setup mode enabled");
  } catch {
    databaseReady = false;
    console.log("Database unavailable; setup mode enabled");
  }
  setupState.databaseReady = databaseReady;

  try {
    const app = createApp({ databaseReady });
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${env.NODE_ENV}`);
      console.log(`API prefix: ${env.API_PREFIX}`);
    });

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
