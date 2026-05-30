import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(databaseUrl?: string) {
  return new PrismaClient({
    ...(databaseUrl
      ? {
          datasources: {
            db: { url: databaseUrl },
          },
        }
      : {}),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "info", "warn", "error"]
        : ["error"],
  });
}

export let prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function configurePrisma(databaseUrl: string): Promise<void> {
  const previous = prisma;
  const next = createPrismaClient(databaseUrl);
  await next.$connect();
  prisma = next;
  globalForPrisma.prisma = next;
  await previous.$disconnect().catch(() => undefined);
}

export async function canConnectDatabase(): Promise<boolean> {
  try {
    await prisma.$connect();
    await prisma.user.count();
    await prisma.storageBackend.count();
    return true;
  } catch {
    return false;
  }
}

export type PrismaTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
