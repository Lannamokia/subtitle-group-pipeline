import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/database";

const PORT = env.PORT;

async function startServer(): Promise<void> {
  try {
    // Test database connection
    await prisma.$connect();
    console.log("Connected to database");

    const app = createApp();

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${env.NODE_ENV}`);
      console.log(`API prefix: ${env.API_PREFIX}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
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
