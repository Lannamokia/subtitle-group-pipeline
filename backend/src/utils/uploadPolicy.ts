import { AppError } from "./response";
import { DEFAULT_ROLE_UPLOAD_POLICY } from "./defaultUploadPolicy";

export type UploadPolicyObject = Record<string, unknown>;

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(value: string): UploadPolicyObject {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hasNonEmptyStringList(value: unknown): boolean {
  return normalizeStringList(value).length > 0;
}

function hasUsableUploadRule(value: unknown): boolean {
  if (hasNonEmptyStringList(value)) {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return [
    "allowed_types",
    "allowedTypes",
    "mime_types",
    "mimeTypes",
    "file_types",
    "fileTypes",
    "extensions",
  ].some((key) => hasNonEmptyStringList(obj[key]));
}

export function hasUsableUploadPolicy(policy: UploadPolicyObject): boolean {
  if (hasUsableUploadRule(policy)) {
    return true;
  }

  for (const key of ["roles", "byRole", "allowedTypes", "allowed_types"]) {
    const matrix = policy[key];
    if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
      continue;
    }
    if (Object.values(matrix as Record<string, unknown>).some(hasUsableUploadRule)) {
      return true;
    }
  }

  return false;
}

export function normalizeUploadPolicyJson(
  uploadPolicyJson: string,
  options: { rejectInvalid?: boolean } = {}
): { json: string; policy: UploadPolicyObject } {
  let parsed: UploadPolicyObject;
  try {
    const value = JSON.parse(uploadPolicyJson);
    if (Array.isArray(value)) {
      const allowedTypes = normalizeStringList(value);
      parsed = allowedTypes.length > 0 ? { allowed_types: allowedTypes } : {};
    } else if (value && typeof value === "object") {
      parsed = value as UploadPolicyObject;
    } else if (options.rejectInvalid) {
      throw new AppError("Upload policy JSON must be an object or string array", "VALIDATION_ERROR", 400);
    } else {
      parsed = {};
    }
  } catch {
    if (options.rejectInvalid) {
      throw new AppError("Invalid upload policy JSON", "VALIDATION_ERROR", 400);
    }
    parsed = {};
  }

  if (!hasUsableUploadPolicy(parsed)) {
    return {
      json: JSON.stringify(DEFAULT_ROLE_UPLOAD_POLICY),
      policy: DEFAULT_ROLE_UPLOAD_POLICY as UploadPolicyObject,
    };
  }

  return {
    json: uploadPolicyJson,
    policy: parsed,
  };
}

export function parseUploadPolicyJson(value: string): UploadPolicyObject {
  return parseJsonObject(value);
}
