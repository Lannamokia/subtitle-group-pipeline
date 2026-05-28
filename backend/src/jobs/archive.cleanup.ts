import { prisma } from "../config/database";
import { deleteFile, initAdapterForBackend } from "../modules/storage/storage.service";

/**
 * Job: Archive Retention Cleanup
 * Runs daily to clean up archived projects that have passed configured retention days.
 * Removes old file versions and intermediate artifacts while preserving only
 * final approved versions per workflow stage.
 * Skips projects that were soft-deleted before the retention period.
 */
export async function cleanupArchivedProjects(): Promise<void> {
  const settings = await prisma.dataRetentionSettings.findFirst();
  const autoDeleteDays = settings?.auto_delete_days;

  if (!autoDeleteDays) {
    console.log("[ArchiveCleanupJob] auto_delete_days not configured, skipping");
    return;
  }

  const cutoffDate = new Date(Date.now() - autoDeleteDays * 24 * 60 * 60 * 1000);

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
    size_bytes: number;
    versions: Array<{
      id: string;
      version_number: number;
      storage_path: string;
      size_bytes: number;
      is_current: boolean;
      is_latest: boolean;
      is_latest_approved: boolean;
      approved_at: Date | null;
    }>;
  }>;
}

async function cleanupProjectArtifacts(project: ProjectWithFiles): Promise<void> {
  const maxVersionsToKeep = await getMaxFileVersions();

  for (const file of project.files) {
    try {
      await cleanupFileVersions(file, project.storage_backend_id, maxVersionsToKeep);
    } catch (error) {
      console.error(`[ArchiveCleanupJob] Failed to cleanup file ${file.id}:`, error);
      // Continue with next file
    }
  }
}

async function cleanupFileVersions(
  file: ProjectWithFiles["files"][0],
  projectBackendId: string | null,
  maxVersionsToKeep: number
): Promise<void> {
  if (file.versions.length <= maxVersionsToKeep) {
    return; // Nothing to clean up
  }

  // Identify versions to preserve:
  // 1. The latest approved version (if any)
  // 2. The current version
  // 3. The latest version
  const approvedVersion = file.versions.find((v) => v.is_latest_approved);
  const currentVersion = file.versions.find((v) => v.is_current);
  const latestVersion = file.versions.find((v) => v.is_latest);

  const preserveIds = new Set<string>();
  if (approvedVersion) preserveIds.add(approvedVersion.id);
  if (currentVersion) preserveIds.add(currentVersion.id);
  if (latestVersion) preserveIds.add(latestVersion.id);

  // Sort by version_number desc to keep the most recent ones
  const sortedVersions = [...file.versions].sort((a, b) => b.version_number - a.version_number);

  // Keep up to maxVersionsToKeep recent versions, plus any approved/current/latest
  const versionsToKeep = new Set<string>();
  let keptCount = 0;
  for (const version of sortedVersions) {
    if (keptCount < maxVersionsToKeep || preserveIds.has(version.id)) {
      versionsToKeep.add(version.id);
      keptCount++;
    }
  }

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

  console.log(`[ArchiveCleanupJob] File "${file.name}": kept ${versionsToKeep.size}/${file.versions.length} versions`);
}

async function deleteFileFromStorage(
  backendId: string,
  storagePath: string,
  sizeBytes: number
): Promise<void> {
  try {
    await deleteFile(backendId, storagePath, sizeBytes);
  } catch (error) {
    // Log but don't fail - the file may already be gone
    console.warn(`[ArchiveCleanupJob] Storage delete warning for ${storagePath}:`, error);
  }
}

async function getMaxFileVersions(): Promise<number> {
  const settings = await prisma.dataRetentionSettings.findFirst();
  return settings?.max_file_versions ?? 10;
}
