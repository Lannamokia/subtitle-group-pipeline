import { PrismaClient, UserRole, RegistrationMode, ProjectType } from "@prisma/client";
import { hashPassword } from "../src/utils/password";

const prisma = new PrismaClient();

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

  // 2. Create default registration policy
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

  // 3. Create default data retention settings
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

  // 4. Create sample project template (standard anime template)
  const animeTemplate = await prisma.projectTemplate.upsert({
    where: { id: "default-anime" },
    update: {},
    create: {
      id: "default-anime",
      name: "Standard Anime Template",
      description: "Default template for anime subtitle projects with standard roles and workflows.",
      project_type: ProjectType.anime,
      roles: JSON.stringify([
        { role: "translator", required: true, description: "Translates Japanese to target language" },
        { role: "editor", required: true, description: "Edits translation for natural flow and accuracy" },
        { role: "timer", required: true, description: "Times subtitles to match audio/video" },
        { role: "typesetter", required: false, description: "Styles and positions subtitles" },
        { role: "qc", required: true, description: "Quality control - final review before release" },
        { role: "encoder", required: false, description: "Encodes final video with subtitles" },
        { role: "distro", required: false, description: "Distributes finished releases" },
        { role: "project_manager", required: true, description: "Manages project timeline and team" },
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

  // 5. Create default local storage backend
  const storageBackend = await prisma.storageBackend.upsert({
    where: { id: "default-local" },
    update: {},
    create: {
      id: "default-local",
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
  console.log("  Username: admin");
  console.log("  Password: admin123");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
