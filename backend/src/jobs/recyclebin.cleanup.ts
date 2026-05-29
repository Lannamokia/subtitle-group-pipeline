import { prisma } from "../config/database";
import { deleteFile, initAdapterForBackend } from "../modules/storage/storage.service";

/**
 * Job: Recycle Bin Physical Cleanup
 * Runs daily to permanently delete soft-deleted projects that have passed
 * the configured recycle-bin retention days.
 * Deletes all associated data: files from storage, database records, and related entities.
 */
export async function cleanupRecycleBin(): Promise<void> {
  const settings = await prisma.dataRetentionSettings.findFirst();
  const recycleBinDays = settings?.recycle_bin_days ?? 30;

  const cutoffDate = new Date(Date.now() - recycleBinDays * 24 * 60 * 60 * 1000);

  // Find soft-deleted projects past retention
  const expiredProjects = await prisma.project.findMany({
    where: {
      deleted_at: { lt: cutoffDate },
    },
    include: {
      files: {
        include: {
          versions: true,
        },
      },
      _count: {
        select: {
          tasks: true,
          members: true,
          units: true,
          reviews: true,
          notifications: true,
          timeline_events: true,
          wiki_documents: true,
          announcements: true,
          audit_logs: true,
          download_links: true,
        },
      },
    },
  });

  if (expiredProjects.length === 0) {
    console.log("[RecycleBinCleanupJob] No expired projects in recycle bin");
    await cleanupOrphanRecycleBinRecords();
    return;
  }

  console.log(`[RecycleBinCleanupJob] Found ${expiredProjects.length} expired project(s) to permanently delete`);

  for (const project of expiredProjects) {
    try {
      await permanentlyDeleteProject(project);
      console.log(`[RecycleBinCleanupJob] Permanently deleted project: ${project.name} (${project.id})`);
    } catch (error) {
      console.error(`[RecycleBinCleanupJob] Failed to delete project ${project.id}:`, error);
      // Continue with next project - do not crash the scheduler
    }
  }

  // Also clean up orphan recycle bin records whose projects are already gone
  await cleanupOrphanRecycleBinRecords();

  console.log(`[RecycleBinCleanupJob] Processed ${expiredProjects.length} expired project(s)`);
}

interface ProjectToDelete {
  id: string;
  name: string;
  storage_backend_id: string | null;
  files: Array<{
    id: string;
    storage_path: string;
    storage_backend_id: string | null;
    size_bytes: number;
    versions: Array<{
      id: string;
      storage_path: string;
      size_bytes: number;
    }>;
  }>;
}

async function permanentlyDeleteProject(project: ProjectToDelete): Promise<void> {
  // Step 1: Delete all physical files from storage
  for (const file of project.files) {
    try {
      const backendId = file.storage_backend_id || project.storage_backend_id;

      // Delete all versions from storage
      for (const version of file.versions) {
        if (backendId) {
          try {
            await deleteFile(backendId, version.storage_path, version.size_bytes);
          } catch (error) {
            console.warn(`[RecycleBinCleanupJob] Storage delete warning for version ${version.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[RecycleBinCleanupJob] Failed to delete file ${file.id} from storage:`, error);
      // Continue - try to delete DB records even if storage delete fails
    }
  }

  // Step 2: Delete related entities in a transaction
  // Use a transaction to ensure consistency
  await prisma.$transaction(async (tx) => {
    const fileIds = project.files.map((f) => f.id);

    // Delete comments on file versions in this project before versions are removed
    await tx.comment.deleteMany({
      where: { file_version: { file_id: { in: fileIds } } },
    });

    // Delete file versions first (they have FK to FileEntity)
    if (fileIds.length > 0) {
      await tx.fileVersion.deleteMany({
        where: { file_id: { in: fileIds } },
      });
    }

    // Delete link history
    await tx.linkHistory.deleteMany({
      where: { project_id: project.id },
    });

    // Delete download links
    await tx.downloadLink.deleteMany({
      where: { project_id: project.id },
    });

    // Delete file entities
    await tx.fileEntity.deleteMany({
      where: { project_id: project.id },
    });

    // Delete translation submissions
    await tx.translationSubmission.deleteMany({
      where: { task: { project_id: project.id } },
    });

    // Delete translation claims
    await tx.translationClaim.deleteMany({
      where: { task: { project_id: project.id } },
    });

    // Delete review snapshots
    await tx.reviewSnapshot.deleteMany({
      where: { review: { project_id: project.id } },
    });

    // Delete reviews
    await tx.review.deleteMany({
      where: { project_id: project.id },
    });

    // Delete task dependencies
    await tx.taskDependency.deleteMany({
      where: {
        OR: [
          { task: { project_id: project.id } },
          { depends_on: { project_id: project.id } },
        ],
      },
    });

    // Delete tasks
    await tx.task.deleteMany({
      where: { project_id: project.id },
    });

    // Delete project units
    await tx.projectUnit.deleteMany({
      where: { project_id: project.id },
    });

    // Delete join requests
    await tx.joinRequest.deleteMany({
      where: { project_id: project.id },
    });

    // Delete project members
    await tx.projectMember.deleteMany({
      where: { project_id: project.id },
    });

    // Delete timeline events
    await tx.timelineEvent.deleteMany({
      where: { project_id: project.id },
    });

    // Delete notifications for this project
    // First delete notification deliveries
    const projectNotifications = await tx.notification.findMany({
      where: { project_id: project.id },
      select: { id: true },
    });
    const notificationIds = projectNotifications.map((n) => n.id);
    if (notificationIds.length > 0) {
      await tx.notificationDelivery.deleteMany({
        where: { notification_id: { in: notificationIds } },
      });
      await tx.notification.deleteMany({
        where: { id: { in: notificationIds } },
      });
    }

    // Delete wiki documents (and their comments)
    const wikiDocs = await tx.wikiDocument.findMany({
      where: { project_id: project.id },
      select: { id: true },
    });
    const wikiIds = wikiDocs.map((w) => w.id);
    if (wikiIds.length > 0) {
      await tx.comment.deleteMany({
        where: { wiki_id: { in: wikiIds } },
      });
      await tx.wikiDocument.deleteMany({
        where: { id: { in: wikiIds } },
      });
    }

    // Delete announcements
    await tx.announcement.deleteMany({
      where: { project_id: project.id },
    });

    // Delete merge jobs
    await tx.mergeJob.deleteMany({
      where: { project_id: project.id },
    });

    // Delete subtitle conflicts
    await tx.subtitleConflict.deleteMany({
      where: { project_id: project.id },
    });

    // Delete recycle bin records for this project
    await tx.recycleBinRecord.deleteMany({
      where: {
        resource_type: "project",
        resource_id: project.id,
      },
    });

    // Finally, delete the project itself
    await tx.project.delete({
      where: { id: project.id },
    });
  });

  console.log(`[RecycleBinCleanupJob] All data for project ${project.id} permanently deleted`);
}

async function cleanupOrphanRecycleBinRecords(): Promise<void> {
  // Find recycle bin records for projects that no longer exist
  const orphanRecords = await prisma.recycleBinRecord.findMany({
    where: {
      resource_type: "project",
      expires_at: { lt: new Date() },
      restored_at: null,
      resource_id: {
        notIn: await prisma.project.findMany({ select: { id: true } }).then((projects) =>
          projects.map((p) => p.id)
        ),
      },
    },
  });

  if (orphanRecords.length === 0) {
    return;
  }

  for (const record of orphanRecords) {
    try {
      await prisma.recycleBinRecord.delete({
        where: { id: record.id },
      });
    } catch (error) {
      console.error(`[RecycleBinCleanupJob] Failed to delete orphan record ${record.id}:`, error);
    }
  }

  console.log(`[RecycleBinCleanupJob] Cleaned up ${orphanRecords.length} orphan recycle bin record(s)`);
}
