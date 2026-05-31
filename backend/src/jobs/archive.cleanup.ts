import { prisma } from "../config/database";
import { deleteFile } from "../modules/storage/storage.service";

/**
 * Job: Archive Retention Cleanup
 * Runs daily to clean up archived projects that have passed configured retention days.
 * Removes old file versions and intermediate artifacts while preserving only
 * final approved versions per workflow stage.
 * Skips projects that were soft-deleted before the retention period.
 */
export async function cleanupArchivedProjects(): Promise<void> {
  const settings = await prisma.dataRetentionSettings.findFirst();
  const archiveRetentionDays = settings?.archive_retention_days ?? settings?.auto_delete_days;

  if (!archiveRetentionDays) {
    console.log("[ArchiveCleanupJob] archive_retention_days not configured, skipping");
    return;
  }

  const cutoffDate = new Date(Date.now() - archiveRetentionDays * 24 * 60 * 60 * 1000);

  // Find archived projects that are NOT soft-deleted and passed retention
  const archivedProjects = await prisma.project.findMany({
    where: {
      is_archived: true,
      deleted_at: null,
      archived_at: { lt: cutoffDate },
    },
    include: {
      storage_backend: true,
      files: {
        where: { is_deleted: false },
        include: {
          versions: {
            orderBy: { version_number: "desc" },
          },
        },
      },
    },
  });

  if (archivedProjects.length === 0) {
    console.log("[ArchiveCleanupJob] No archived projects passed retention period");
    return;
  }

  console.log(`[ArchiveCleanupJob] Found ${archivedProjects.length} archived project(s) for cleanup`);

  for (const project of archivedProjects) {
    try {
      await cleanupProjectArtifacts(project);
      console.log(`[ArchiveCleanupJob] Cleaned up project: ${project.name} (${project.id})`);
    } catch (error) {
      console.error(`[ArchiveCleanupJob] Failed to cleanup project ${project.id}:`, error);
      // Continue with next project - do not crash the scheduler
    }
  }

  console.log(`[ArchiveCleanupJob] Processed ${archivedProjects.length} archived project(s)`);
}

interface ProjectWithFiles {
  id: string;
  name: string;
  storage_backend_id: string | null;
  storage_backend: {
    id: string;
    backend_type: string;
    config: string;
  } | null;
  files: Array<{
    id: string;
    name: string;
    storage_path: string;
    storage_backend_id: string | null;
    size_bytes: number | bigint;
    versions: Array<{
      id: string;
      version_number: number;
      storage_path: string;
      size_bytes: number | bigint;
      is_current: boolean;
      is_latest: boolean;
      is_latest_approved: boolean;
      approved_at: Date | null;
    }>;
  }>;
}

async function cleanupProjectArtifacts(project: ProjectWithFiles): Promise<void> {
  for (const file of project.files) {
    try {
      await cleanupFileVersions(file, project.storage_backend_id);
    } catch (error) {
      console.error(`[ArchiveCleanupJob] Failed to cleanup file ${file.id}:`, error);
      // Continue with next file
    }
  }
}

async function cleanupFileVersions(
  file: ProjectWithFiles["files"][0],
  projectBackendId: string | null
): Promise<void> {
  if (file.versions.length <= 1) {
    return; // Nothing to clean up
  }

  const sortedVersions = [...file.versions].sort((a, b) => b.version_number - a.version_number);
  const finalApprovedVersion =
    sortedVersions.find((v) => v.is_latest_approved) ||
    sortedVersions
      .filter((v) => v.approved_at)
      .sort((a, b) => {
        const dateDiff = (b.approved_at?.getTime() ?? 0) - (a.approved_at?.getTime() ?? 0);
        return dateDiff || b.version_number - a.version_number;
      })[0];
  const fallbackVersion =
    sortedVersions.find((v) => v.is_current) ||
    sortedVersions.find((v) => v.is_latest) ||
    sortedVersions[0];

  // Archived projects should keep the final approved artifact for each file/stage.
  // If legacy data has no approved version, keep one current/latest fallback so the
  // file bucket never points at an empty version chain.
  const versionToKeep = finalApprovedVersion || fallbackVersion;
  const versionsToKeep = new Set<string>(versionToKeep ? [versionToKeep.id] : []);

  // Delete versions not in the keep set
  for (const version of file.versions) {
    if (!versionsToKeep.has(version.id)) {
      try {
        // Delete physical file from storage
        const backendId = file.storage_backend_id || projectBackendId;
        if (backendId) {
          await deleteFileFromStorage(backendId, version.storage_path, version.size_bytes);
        }

        // Delete version record from database
        await prisma.fileVersion.delete({
          where: { id: version.id },
        });
      } catch (error) {
        console.error(`[ArchiveCleanupJob] Failed to delete version ${version.id}:`, error);
        // Continue with next version
      }
    }
  }

  if (versionToKeep) {
    await prisma.fileVersion.update({
      where: { id: versionToKeep.id },
      data: {
        is_current: true,
        is_latest: true,
        is_latest_approved: Boolean(finalApprovedVersion),
      },
    });
  }

  console.log(`[ArchiveCleanupJob] File "${file.name}": kept ${versionsToKeep.size}/${file.versions.length} final version(s)`);
}

async function deleteFileFromStorage(
  backendId: string,
  storagePath: string,
  sizeBytes: number | bigint
): Promise<void> {
  try {
    await deleteFile(backendId, storagePath, sizeBytes);
  } catch (error) {
    // Log but don't fail - the file may already be gone
    console.warn(`[ArchiveCleanupJob] Storage delete warning for ${storagePath}:`, error);
  }
}
