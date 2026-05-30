import { PrismaClient, UserRole, RegistrationMode, ProjectType } from "@prisma/client";
import { hashPassword } from "../src/utils/password";

const prisma = new PrismaClient();

const DEFAULT_TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_STORAGE_BACKEND_ID = "22222222-2222-4222-8222-222222222222";

async function main(): Promise<void> {
  console.log("Starting seed...");

  // 1. Create super admin user
  const adminPassword = await hashPassword("admin123");
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      password_hash: adminPassword,
      nickname: "Administrator",
      email: "admin@example.com",
      role: UserRole.super_admin,
      status: "active",
    },
  });
  console.log(`Created super admin: ${admin.username} (id: ${admin.id})`);

  // 2. Create group_admin user
  const groupAdminPassword = await hashPassword("groupadmin123");
  const groupAdmin = await prisma.user.upsert({
    where: { username: "groupadmin" },
    update: {},
    create: {
      username: "groupadmin",
      password_hash: groupAdminPassword,
      nickname: "Group Admin",
      email: "groupadmin@example.com",
      role: UserRole.group_admin,
      status: "active",
    },
  });
  console.log(`Created group admin: ${groupAdmin.username} (id: ${groupAdmin.id})`);

  // 3. Create supervisor user
  const supervisorPassword = await hashPassword("supervisor123");
  const supervisor = await prisma.user.upsert({
    where: { username: "supervisor" },
    update: {},
    create: {
      username: "supervisor",
      password_hash: supervisorPassword,
      nickname: "Supervisor",
      email: "supervisor@example.com",
      role: UserRole.supervisor,
      status: "active",
    },
  });
  console.log(`Created supervisor: ${supervisor.username} (id: ${supervisor.id})`);

  // 4. Create member user
  const memberPassword = await hashPassword("member123");
  const member = await prisma.user.upsert({
    where: { username: "member" },
    update: {},
    create: {
      username: "member",
      password_hash: memberPassword,
      nickname: "Member",
      email: "member@example.com",
      role: UserRole.member,
      status: "active",
    },
  });
  console.log(`Created member: ${member.username} (id: ${member.id})`);

  // 5. Create default registration policy
  const regPolicy = await prisma.registrationPolicy.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      mode: RegistrationMode.open,
      require_qq: false,
      welcome_message: "Welcome to the subtitle group collaboration platform!",
      auto_approve: true,
    },
  });
  console.log(`Created registration policy: ${regPolicy.mode}`);

  // 6. Create default data retention settings
  const retention = await prisma.dataRetentionSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      auto_archive_days: 90,
      auto_delete_days: 365,
      recycle_bin_days: 30,
      audit_log_retention_days: 365,
      notification_retention_days: 30,
      max_file_versions: 10,
    },
  });
  console.log(`Created data retention settings (archive after ${retention.auto_archive_days} days)`);

  // 7. Create sample project template (standard anime template)
  const animeTemplate = await prisma.projectTemplate.upsert({
    where: { id: DEFAULT_TEMPLATE_ID },
    update: {},
    create: {
      id: DEFAULT_TEMPLATE_ID,
      name: "Standard Anime Template",
      description: "Default template for anime subtitle projects with standard roles and workflows.",
      project_type: ProjectType.anime,
      roles: JSON.stringify([
        { role: "source", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "timing", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "translation", enabled: true, slotCount: 3, assignmentStrategy: "open_claim", maxSegmentLength: 300 },
        { role: "post_production", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "encoding", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
        { role: "release", enabled: true, slotCount: 1, assignmentStrategy: "manual" },
      ]),
      upload_policy: JSON.stringify({
        allowedTypes: [
          "text/plain",
          "application/x-ass",
          "video/mp4",
          "video/x-matroska",
          "audio/mp3",
          "audio/flac",
          "image/png",
          "image/jpeg",
          "application/zip",
          "application/x-rar-compressed",
        ],
        maxSize: 104857600,
        requireApproval: false,
        extensionWhitelist: [
          ".ass", ".ssa", ".srt", ".txt",
          ".mp4", ".mkv", ".avi",
          ".mp3", ".flac", ".aac",
          ".png", ".jpg", ".jpeg",
          ".zip", ".rar", ".7z",
          ".ttf", ".otf", ".woff",
        ],
      }),
      notification_policy: JSON.stringify({
        channels: ["in_app"],
        events: [
          "task.assigned",
          "task.completed",
          "review.requested",
          "review.completed",
          "file.uploaded",
          "join.request",
        ],
      }),
      ass_policy: JSON.stringify({
        format: "Advanced SubStation Alpha",
        styleRules: {
          defaultFont: "Arial",
          defaultSize: 24,
          marginV: 30,
          marginL: 30,
          marginR: 30,
          outline: 2,
          shadow: 1,
        },
        timingRules: {
          minDuration: 1000,
          maxDuration: 7000,
          minGap: 200,
          snapToKeyframes: true,
        },
      }),
      product_config: JSON.stringify({
        resolutions: ["1080p", "720p"],
        codecs: ["H.264", "H.265/HEVC"],
        containers: ["MKV", "MP4"],
        subtitleFormats: ["ASS", "SRT"],
      }),
      delivery_checklist: JSON.stringify([
        { item: "All episodes translated", required: true },
        { item: "Translation edited and reviewed", required: true },
        { item: "Timing checked and corrected", required: true },
        { item: "Typesetting completed", required: false },
        { item: "QC passed", required: true },
        { item: "Video encoded", required: false },
        { item: "Release notes prepared", required: false },
        { item: "Distribution links created", required: false },
      ]),
      is_default: true,
    },
  });
  console.log(`Created project template: ${animeTemplate.name}`);

  // 8. Create default local storage backend
  const storageBackend = await prisma.storageBackend.upsert({
    where: { id: DEFAULT_STORAGE_BACKEND_ID },
    update: {},
    create: {
      id: DEFAULT_STORAGE_BACKEND_ID,
      name: "Default Local Storage",
      backend_type: "local",
      config: JSON.stringify({
        basePath: "./uploads",
        publicUrl: "/uploads",
      }),
      is_default: true,
      is_active: true,
    },
  });
  console.log(`Created storage backend: ${storageBackend.name}`);

  console.log("\nSeed completed successfully!");
  console.log("\nLogin credentials:");
  console.log("  Username: admin        Password: admin123       Role: super_admin");
  console.log("  Username: groupadmin   Password: groupadmin123  Role: group_admin");
  console.log("  Username: supervisor   Password: supervisor123  Role: supervisor");
  console.log("  Username: member       Password: member123      Role: member");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
