import fs from "fs";
import path from "path";
import { env } from "../../../config/env";
import { AppError } from "../../../utils/response";
import crypto from "crypto";

const UPLOAD_DIR = env.UPLOAD_DIR;

function generateRandomFilename(): string {
  return crypto.randomBytes(16).toString("hex");
}

function preventPathTraversal(filepath: string): string {
  const resolved = path.resolve(UPLOAD_DIR, filepath);
  const uploadDirResolved = path.resolve(UPLOAD_DIR);

  if (!resolved.startsWith(uploadDirResolved + path.sep) && resolved !== uploadDirResolved) {
    throw new AppError("Invalid file path: path traversal detected", "FORBIDDEN", 403);
  }

  return resolved;
}

export async function ensureUploadDir(): Promise<void> {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export function generateInternalPath(projectId: string, ext: string): string {
  const randomName = generateRandomFilename();
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").substring(0, 20);
  return path.join("projects", projectId, `${randomName}${safeExt}`);
}

export interface LocalUploadResult {
  internalPath: string;
  size: number;
  url: string;
}

export interface LocalStats {
  totalBytes: number;
  fileCount: number;
  backendType: "local";
}

export class LocalAdapter {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || `${env.API_PREFIX}/download`;
  }

  async upload(
    projectId: string,
    buffer: Buffer,
    originalFilename: string
  ): Promise<LocalUploadResult> {
    await ensureUploadDir();

    const ext = path.extname(originalFilename) || ".bin";
    const internalPath = generateInternalPath(projectId, ext);
    const safePath = preventPathTraversal(internalPath);
    const dir = path.dirname(safePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(safePath, buffer);

    return {
      internalPath,
      size: buffer.length,
      url: this.getUrl(internalPath),
    };
  }

  async download(internalPath: string): Promise<Buffer> {
    const safePath = preventPathTraversal(internalPath);

    if (!fs.existsSync(safePath)) {
      throw new AppError("File not found", "NOT_FOUND", 404);
    }

    return fs.readFileSync(safePath);
  }

  async delete(internalPath: string): Promise<void> {
    const safePath = preventPathTraversal(internalPath);

    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);

      // Clean up empty parent directories
      const dir = path.dirname(safePath);
      try {
        const entries = fs.readdirSync(dir);
        if (entries.length === 0) {
          fs.rmdirSync(dir);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  getUrl(internalPath: string): string {
    // Return a token-based download URL
    return `${this.baseUrl}/${encodeURIComponent(internalPath)}`;
  }

  async getStats(): Promise<LocalStats> {
    await ensureUploadDir();

    let totalBytes = 0;
    let fileCount = 0;

    function walk(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          totalBytes += stat.size;
          fileCount++;
        }
      }
    }

    walk(UPLOAD_DIR);

    return {
      totalBytes,
      fileCount,
      backendType: "local",
    };
  }

  async exists(internalPath: string): Promise<boolean> {
    try {
      const safePath = preventPathTraversal(internalPath);
      return fs.existsSync(safePath);
    } catch {
      return false;
    }
  }
}
