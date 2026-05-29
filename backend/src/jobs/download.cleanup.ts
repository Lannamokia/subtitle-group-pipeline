import { prisma } from "../config/database";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

/**
 * Job: Download Link Expiration Cleanup
 * Runs every 30 seconds to delete expired download_links records.
 * Also cleans up associated local temp files if any.
 */
export async function cleanupExpiredDownloadLinks(): Promise<void> {
  const now = new Date();

  // Find expired download links
  const expiredLinks = await prisma.downloadLink.findMany({
    where: {
      expires_at: { lt: now },
    },
  });

  if (expiredLinks.length === 0) {
    return;
  }

  console.log(`[DownloadCleanupJob] Found ${expiredLinks.length} expired download link(s)`);

  // Collect file IDs for temp file cleanup
  const fileIds = expiredLinks
    .map((link) => link.file_id)
    .filter((id): id is string => id !== null);

  // Fetch file info for temp cleanup if there are file IDs
  const fileMap = new Map<string, { storage_path: string }>();
  if (fileIds.length > 0) {
    const files = await prisma.fileEntity.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, storage_path: true },
    });
    for (const file of files) {
      fileMap.set(file.id, file);
    }
  }

  for (const link of expiredLinks) {
    try {
      // Clean up any associated temp files for local storage
      if (link.file_id) {
        const file = fileMap.get(link.file_id);
        if (file?.storage_path) {
          await cleanupTempFile(file.storage_path);
        }
      }

      await prisma.downloadLink.delete({
        where: { id: link.id },
      });

      console.log(`[DownloadCleanupJob] Deleted expired link: ${link.token}`);
    } catch (error) {
      console.error(`[DownloadCleanupJob] Failed to cleanup link ${link.id}:`, error);
      // Continue with next link - do not crash the scheduler
    }
  }

  console.log(`[DownloadCleanupJob] Processed ${expiredLinks.length} expired link(s)`);
}

async function cleanupTempFile(storagePath: string): Promise<void> {
  // Check if this is a local temp file path
  const uploadDir = env.UPLOAD_DIR;

  // Only clean up files in temp or downloads directories
  const normalizedPath = path.normalize(storagePath);
  const isTempFile =
    normalizedPath.includes("/temp/") ||
    normalizedPath.includes("\\temp\\") ||
    normalizedPath.includes("/downloads/") ||
    normalizedPath.includes("\\downloads\\");

  if (!isTempFile) {
    return; // Don't delete project files - only temp downloads
  }

  const fullPath = path.join(uploadDir, normalizedPath);

  // Safety check: ensure path is within upload directory
  const resolvedPath = path.resolve(fullPath);
  const resolvedUploadDir = path.resolve(uploadDir);
  if (!resolvedPath.startsWith(resolvedUploadDir + path.sep)) {
    console.warn(`[DownloadCleanupJob] Skipping unsafe path: ${resolvedPath}`);
    return;
  }

  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`[DownloadCleanupJob] Deleted temp file: ${fullPath}`);
    }
  } catch (error) {
    console.warn(`[DownloadCleanupJob] Failed to delete temp file ${fullPath}:`, error);
  }
}
