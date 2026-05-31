import { execFile, spawn } from "child_process";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { prisma, configurePrisma, canConnectDatabase } from "../../config/database";
import { env } from "../../config/env";
import { AppError } from "../../utils/response";
import { hashPassword } from "../../utils/password";
import * as storageService from "../storage/storage.service";
import type { CompleteSetupInput } from "./setup.schema";
import { setupState } from "./setup.state";

const execFileAsync = promisify(execFile);
const ENV_PATH = path.resolve(process.cwd(), ".env");
const SCHEMA_PATH = path.resolve(process.cwd(), "prisma/schema.prisma");
const SCHEMA_DIR = path.dirname(SCHEMA_PATH);
const MIGRATIONS_DIR = path.join(SCHEMA_DIR, "migrations");

function inferProvider(url: string): "sqlite" | "mysql" | "mariadb" | "postgresql" | "unknown" {
  if (url.startsWith("file:")) return "sqlite";
  if (url.startsWith("mariadb://")) return "mariadb";
  if (url.startsWith("mysql://") || url.startsWith("mariadb://")) return "mysql";
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) return "postgresql";
  return "unknown";
}

function prismaProvider(provider: string): "sqlite" | "mysql" | "postgresql" {
  if (provider === "mariadb") return "mysql";
  if (provider === "postgresql") return "postgresql";
  return provider === "mysql" ? "mysql" : "sqlite";
}

function updateEnvFile(updates: Record<string, string>) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${JSON.stringify(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      next.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  fs.writeFileSync(ENV_PATH, next.filter((line, index, array) => line || index < array.length - 1).join("\n") + "\n");
}

function buildPrismaSchema(provider: "sqlite" | "mysql" | "postgresql") {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  return schema.replace(/provider\s*=\s*"(sqlite|mysql|postgresql)"/, `provider = "${provider}"`);
}

async function syncSchema(
  databaseUrl: string,
  provider: "sqlite" | "mysql" | "postgresql",
  options: { acceptDataLoss?: boolean } = {}
) {
  if (provider === "sqlite") {
    await applySqliteMigrations(databaseUrl);
    return;
  }

  const env = { ...process.env, DATABASE_URL: databaseUrlForPrismaCli(databaseUrl, provider) };
  const tempSchemaPath = path.join(SCHEMA_DIR, `.setup-${crypto.randomUUID()}.prisma`);
  try {
    fs.writeFileSync(tempSchemaPath, buildPrismaSchema(provider));
    const args = ["db", "push", "--skip-generate", "--schema", tempSchemaPath];
    if (options.acceptDataLoss) {
      args.splice(2, 0, "--accept-data-loss");
    }
    await runPrismaCommand(args, env);
  } finally {
    fs.rmSync(tempSchemaPath, { force: true });
  }
}

export async function upgradeConfiguredDatabaseSchema() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return { skipped: true as const, reason: "not_configured" as const };
  }

  const inferred = inferProvider(databaseUrl);
  if (inferred === "unknown") {
    throw new AppError("Unsupported database URL scheme", "VALIDATION_ERROR", 400);
  }

  const provider = prismaProvider(inferred);
  await syncSchema(databaseUrl, provider);

  return {
    skipped: false as const,
    provider,
  };
}

async function generatePrismaClient(databaseUrl: string, provider: "sqlite" | "mysql" | "postgresql") {
  const env = { ...process.env, DATABASE_URL: databaseUrlForPrismaCli(databaseUrl, provider) };
  const tempSchemaPath = path.join(SCHEMA_DIR, `.setup-generate-${crypto.randomUUID()}.prisma`);
  try {
    fs.writeFileSync(tempSchemaPath, buildPrismaSchema(provider));
    await runPrismaCommand(["generate", "--schema", tempSchemaPath], env);
  } finally {
    fs.rmSync(tempSchemaPath, { force: true });
  }
}

function isRespawnManagedProcess() {
  const argv = process.argv.join(" ").toLowerCase();
  return Boolean(
    process.env.TS_NODE_DEV ||
      process.env.NODEMON ||
      process.env.PM2_HOME ||
      process.env.JEST_WORKER_ID ||
      process.env.npm_lifecycle_event === "dev" ||
      argv.includes("ts-node-dev") ||
      argv.includes("nodemon")
  );
}

function spawnDetachedRestartHelper(restartDelayMs: number) {
  const currentArgs = process.argv.slice(1);
  if (currentArgs.length === 0) return;

  const helperScript = `
const { spawn } = require("child_process");
const [execPath, cwd, delayMsText, ...args] = process.argv.slice(1);
const delayMs = Number(delayMsText) || 1500;
setTimeout(() => {
  const child = spawn(execPath, args, {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}, delayMs);
`;

  const helper = spawn(process.execPath, ["-e", helperScript, process.execPath, process.cwd(), String(restartDelayMs), ...currentArgs], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  helper.unref();
}

function scheduleServerRestart() {
  const delayMs = Math.max(500, Number(process.env.SETUP_RESTART_DELAY_MS ?? 1500));
  const restartDelayMs = Math.max(1000, Number(process.env.SETUP_RESTART_CHILD_DELAY_MS ?? 1500));
  const timer = setTimeout(() => {
    console.log("Setup completed. Restarting server to load the selected database provider...");
    if (!isRespawnManagedProcess()) {
      spawnDetachedRestartHelper(restartDelayMs);
    }
    process.exit(0);
  }, delayMs);
  timer.unref();
}

async function applySqliteMigrations(databaseUrl: string) {
  const sqlitePath = sqliteFilePath(databaseUrl);
  if (!sqlitePath) {
    throw new AppError("Only file-based SQLite databases can be initialized", "VALIDATION_ERROR", 400);
  }

  ensureSqliteDirectory(sqlitePath);
  const db = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
    log: process.env.NODE_ENV === "development" ? ["error"] : ["error"],
  });

  try {
    await db.$connect();
    await db.$executeRawUnsafe("PRAGMA foreign_keys=OFF");
    await db.$executeRawUnsafe("BEGIN");
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "checksum" TEXT NOT NULL,
        "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )
    `);

    const migrationDirs = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => fs.existsSync(path.join(MIGRATIONS_DIR, name, "migration.sql")))
      .sort();

    for (const dir of migrationDirs) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
      const existing = await db.$queryRawUnsafe<Array<{ applied: number }>>(
        'SELECT 1 AS applied FROM "_prisma_migrations" WHERE "migration_name" = ? LIMIT 1',
        dir
      );
      if (existing.length > 0) continue;

      for (const statement of splitSqlStatements(sql)) {
        await db.$executeRawUnsafe(statement);
      }

      await db.$executeRawUnsafe(
        `
          INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
          VALUES (?, ?, CURRENT_TIMESTAMP, ?, NULL, NULL, CURRENT_TIMESTAMP, 1)
        `,
        crypto.randomUUID(),
        crypto.createHash("sha256").update(sql).digest("hex"),
        dir
      );
    }

    await db.$executeRawUnsafe("COMMIT");
    await db.$executeRawUnsafe("PRAGMA foreign_keys=ON");
  } catch (error) {
    await db.$executeRawUnsafe("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await db.$disconnect();
  }
}

function splitSqlStatements(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function sqliteFilePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return null;
  const rawPath = databaseUrl.slice("file:".length);
  if (!rawPath || rawPath === ":memory:") return null;
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(SCHEMA_DIR, rawPath);
}

function databaseUrlForPrismaCli(databaseUrl: string, provider: "sqlite" | "mysql" | "postgresql") {
  if (provider === "mysql" && databaseUrl.startsWith("mariadb://")) {
    return `mysql://${databaseUrl.slice("mariadb://".length)}`;
  }

  if (provider !== "sqlite" || !databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  const rawPath = databaseUrl.slice("file:".length);
  ensureSqliteDirectory(path.isAbsolute(rawPath) ? rawPath : path.resolve(SCHEMA_DIR, rawPath));
  return databaseUrl;
}

function ensureSqliteDirectory(sqlitePath: string) {
  if (!sqlitePath || sqlitePath === ":memory:") return;
  const directory = path.dirname(sqlitePath);
  fs.mkdirSync(directory, { recursive: true });
}

async function runPrismaCommand(args: string[], env: NodeJS.ProcessEnv) {
  const prismaCli = path.resolve(process.cwd(), "node_modules/prisma/build/index.js");
  try {
    await execFileAsync(process.execPath, [prismaCli, ...args], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
    });
  } catch (error) {
    const details = formatPrismaCommandError(error);
    throw new AppError(details || "Database setup failed", "DATABASE_SETUP_FAILED", 400);
  }
}

function formatPrismaCommandError(error: unknown): string {
  const commandError = error as Error & { stderr?: string; stdout?: string };
  const raw = (commandError.stderr || commandError.stdout || commandError.message || "").trim();

  if (/permission denied for schema public/i.test(raw)) {
    return [
      "PostgreSQL 当前用户没有在 public schema 中建表的权限。",
      "请使用拥有建表权限的数据库用户，或执行 GRANT USAGE, CREATE ON SCHEMA public TO <用户名>；",
      "也可以预先创建专用 schema 并在连接串添加 ?schema=<schema_name>。",
    ].join("");
  }

  return raw
    .split(/\r?\n/)
    .filter((line) => {
      const text = line.trim();
      if (!text) return true;
      if (text.includes("configuration property `package.json#prisma` is deprecated")) return false;
      if (text.includes("https://pris.ly/prisma-config")) return false;
      if (text === "Environment variables loaded from .env") return false;
      return true;
    })
    .join("\n")
    .trim();
}

function sqlString(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlBool(value: boolean, provider: "sqlite" | "mysql" | "postgresql"): string {
  if (provider === "postgresql") return value ? "true" : "false";
  return value ? "1" : "0";
}

function sqlNow(provider: "sqlite" | "mysql" | "postgresql"): string {
  if (provider === "postgresql") return "CURRENT_TIMESTAMP";
  return "CURRENT_TIMESTAMP";
}

function quoteIdent(identifier: string, provider: "sqlite" | "mysql" | "postgresql"): string {
  return provider === "mysql" ? `\`${identifier}\`` : `"${identifier}"`;
}

async function executeSql(databaseUrl: string, provider: "sqlite" | "mysql" | "postgresql", sql: string) {
  const env = { ...process.env, DATABASE_URL: databaseUrlForPrismaCli(databaseUrl, provider) };
  const id = crypto.randomUUID();
  const tempSchemaPath = path.join(SCHEMA_DIR, `.setup-sql-${id}.prisma`);
  const sqlPath = path.join(SCHEMA_DIR, `.setup-sql-${id}.sql`);
  try {
    fs.writeFileSync(tempSchemaPath, buildPrismaSchema(provider));
    fs.writeFileSync(sqlPath, sql);
    await runPrismaCommand(["db", "execute", "--schema", tempSchemaPath, "--file", sqlPath], env);
  } finally {
    fs.rmSync(tempSchemaPath, { force: true });
    fs.rmSync(sqlPath, { force: true });
  }
}

function buildBootstrapSql(args: {
  provider: "sqlite" | "mysql" | "postgresql";
  adminId: string;
  username: string;
  passwordHash: string;
  nickname: string;
  email?: string;
  storageId: string;
  storageName: string;
  backendType: string;
  storageConfig: string;
  quotaBytes?: number | null;
}) {
  const q = (identifier: string) => quoteIdent(identifier, args.provider);
  const userTable = q("User");
  const storageTable = q("StorageBackend");
  const now = sqlNow(args.provider);
  const quota = args.quotaBytes === null || args.quotaBytes === undefined ? "NULL" : String(args.quotaBytes);

  return [
    `INSERT INTO ${userTable} (${q("id")}, ${q("username")}, ${q("nickname")}, ${q("email")}, ${q("password_hash")}, ${q("role")}, ${q("status")}, ${q("created_at")}, ${q("updated_at")}) VALUES (${sqlString(args.adminId)}, ${sqlString(args.username)}, ${sqlString(args.nickname)}, ${sqlString(args.email)}, ${sqlString(args.passwordHash)}, ${sqlString("super_admin")}, ${sqlString("active")}, ${now}, ${now});`,
    `UPDATE ${storageTable} SET ${q("is_default")} = ${sqlBool(false, args.provider)}, ${q("updated_at")} = ${now};`,
    `INSERT INTO ${storageTable} (${q("id")}, ${q("name")}, ${q("backend_type")}, ${q("config")}, ${q("is_default")}, ${q("is_active")}, ${q("quota_bytes")}, ${q("used_bytes")}, ${q("file_count")}, ${q("created_at")}, ${q("updated_at")}) VALUES (${sqlString(args.storageId)}, ${sqlString(args.storageName)}, ${sqlString(args.backendType)}, ${sqlString(args.storageConfig)}, ${sqlBool(true, args.provider)}, ${sqlBool(true, args.provider)}, ${quota}, 0, 0, ${now}, ${now});`,
  ].join("\n");
}

export async function getSetupStatus() {
  const databaseReady = await canConnectDatabase();
  if (!databaseReady) {
    return {
      initialized: false,
      databaseReady: false,
      adminExists: false,
      storageReady: false,
      provider: inferProvider(process.env.DATABASE_URL || ""),
    };
  }

  const [adminCount, defaultStorageCount] = await Promise.all([
    prisma.user.count({ where: { role: "super_admin" } }),
    prisma.storageBackend.count({ where: { is_default: true, is_active: true } }),
  ]);

  return {
    initialized: adminCount > 0 && defaultStorageCount > 0,
    databaseReady: true,
    adminExists: adminCount > 0,
    storageReady: defaultStorageCount > 0,
    provider: inferProvider(process.env.DATABASE_URL || ""),
  };
}

export async function completeSetup(input: CompleteSetupInput) {
  const inferred = inferProvider(input.database.url);
  const selectedProvider = prismaProvider(input.database.provider);
  if (prismaProvider(inferred) !== selectedProvider) {
    throw new AppError("Database provider does not match URL scheme", "VALIDATION_ERROR", 400);
  }
  const databaseUrl = databaseUrlForPrismaCli(input.database.url, selectedProvider);

  const passwordHash = await hashPassword(input.admin.password);
  const backendType = input.storage.backend_type as "local" | "s3" | "s3_compatible";
  const config = storageService.normalizeStorageConfig(backendType, input.storage.config);
  await storageService.validateStorageBackendConfig(backendType, config);
  await syncSchema(databaseUrl, selectedProvider);

  if (selectedProvider !== "sqlite") {
    const adminId = crypto.randomUUID();
    const storageId = crypto.randomUUID();
    const sql = buildBootstrapSql({
      provider: selectedProvider,
      adminId,
      username: input.admin.username,
      passwordHash,
      nickname: input.admin.nickname || input.admin.username,
      email: input.admin.email,
      storageId,
      storageName: input.storage.name,
      backendType: input.storage.backend_type,
      storageConfig: config,
      quotaBytes: input.storage.quota_bytes,
    });
    await executeSql(databaseUrl, selectedProvider, sql);
    updateEnvFile({ DATABASE_URL: databaseUrl, JWT_SECRET: input.security.jwt_secret });
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = input.security.jwt_secret;
    env.JWT_SECRET = input.security.jwt_secret;
    await generatePrismaClient(databaseUrl, selectedProvider);
    scheduleServerRestart();

    return {
      initialized: true,
      restartRequired: false,
      restarting: true,
      message: "初始化完成，服务正在自动重启以加载所选数据库类型。",
      admin: { id: adminId, username: input.admin.username, role: "super_admin" },
      storage: { id: storageId, name: input.storage.name, backend_type: input.storage.backend_type, is_default: true },
    };
  }

  updateEnvFile({ DATABASE_URL: databaseUrl, JWT_SECRET: input.security.jwt_secret });
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = input.security.jwt_secret;
  env.JWT_SECRET = input.security.jwt_secret;
  await configurePrisma(databaseUrl);

  const status = await getSetupStatus();
  if (status.initialized) {
    throw new AppError("System is already initialized", "ALREADY_INITIALIZED", 409);
  }

  const [admin, storage] = await prisma.$transaction(async (tx) => {
    const createdAdmin = await tx.user.create({
      data: {
        username: input.admin.username,
        password_hash: passwordHash,
        nickname: input.admin.nickname || input.admin.username,
        email: input.admin.email,
        role: "super_admin",
        status: "active",
      },
      select: {
        id: true,
        username: true,
        nickname: true,
        email: true,
        role: true,
        status: true,
        created_at: true,
      },
    });

    await tx.storageBackend.updateMany({ data: { is_default: false } });
    const createdStorage = await tx.storageBackend.create({
      data: {
        name: input.storage.name,
        backend_type: input.storage.backend_type,
        config,
        is_default: true,
        is_active: true,
        quota_bytes:
          input.storage.quota_bytes === null || input.storage.quota_bytes === undefined
            ? input.storage.quota_bytes
            : BigInt(input.storage.quota_bytes),
      },
    });

    return [createdAdmin, storageService.serializeStorageBackend(createdStorage)] as const;
  });

  setupState.databaseReady = true;

  return {
    initialized: true,
    restartRequired: false,
    admin,
    storage,
  };
}
