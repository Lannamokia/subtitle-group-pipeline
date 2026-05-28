import fs from "fs";
import path from "path";
import { env } from "../../../config/env";
import { AppError } from "../../../utils/response";

const UPLOAD_DIR = env.UPLOAD_DIR;

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function preventPathTraversal(filepath: string): string {
  const resolved = path.resolve(UPLOAD_DIR, filepath);
  const uploadDirResolved = path.resolve(UPLOAD_DIR);

  if (!resolved.startsWith(uploadDirResolved)) {
    throw new AppError("Invalid file path", "FORBIDDEN", 403);
  }

  return resolved;
}

export async function ensureUploadDir(): Promise<void> {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export async function saveFile(
  buffer: Buffer,
  relativePath: string
): Promise<{ path: string; size: number }> {
  await ensureUploadDir();

  const safePath = preventPathTraversal(relativePath);
  const dir = path.dirname(safePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(safePath, buffer);

  return {
    path: relativePath,
    size: buffer.length,
  };
}

export async function readFile(relativePath: string): Promise<Buffer> {
  const safePath = preventPathTraversal(relativePath);

  if (!fs.existsSync(safePath)) {
    throw new AppError("File not found", "NOT_FOUND", 404);
  }

  return fs.readFileSync(safePath);
}

export async function deleteFile(relativePath: string): Promise<void> {
  const safePath = preventPathTraversal(relativePath);

  if (fs.existsSync(safePath)) {
    fs.unlinkSync(safePath);
  }
}

export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    const safePath = preventPathTraversal(relativePath);
    return fs.existsSync(safePath);
  } catch {
    return false;
  }
}

export function generateStoragePath(
  projectId: string,
  filename: string
): string {
  const timestamp = Date.now();
  const safeName = sanitizeFilename(filename);
  return path.join("projects", projectId, `${timestamp}_${safeName}`);
}
