const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const rootDir = process.cwd();
const schemaPath = path.join(rootDir, "prisma", "schema.prisma");
const schemaDir = path.dirname(schemaPath);

function inferProvider(databaseUrl) {
  if (!databaseUrl || databaseUrl.startsWith("file:")) return "sqlite";
  if (databaseUrl.startsWith("mysql://") || databaseUrl.startsWith("mariadb://")) return "mysql";
  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) return "postgresql";
  return "sqlite";
}

function databaseUrlForPrisma(databaseUrl, provider) {
  if (provider === "mysql" && databaseUrl.startsWith("mariadb://")) {
    return `mysql://${databaseUrl.slice("mariadb://".length)}`;
  }
  return databaseUrl;
}

function buildPrismaSchema(provider) {
  const schema = fs.readFileSync(schemaPath, "utf8");
  return schema.replace(/provider\s*=\s*"(sqlite|mysql|postgresql)"/, `provider = "${provider}"`);
}

const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const provider = inferProvider(databaseUrl);
const tempSchemaPath = path.join(schemaDir, `.runtime-generate-${process.pid}-${Date.now()}.prisma`);
const prismaCli = path.join(rootDir, "node_modules", "prisma", "build", "index.js");

try {
  fs.writeFileSync(tempSchemaPath, buildPrismaSchema(provider));
  execFileSync(process.execPath, [prismaCli, "generate", "--schema", tempSchemaPath], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: databaseUrlForPrisma(databaseUrl, provider) },
    stdio: "inherit",
    windowsHide: true,
  });
} finally {
  fs.rmSync(tempSchemaPath, { force: true });
}
