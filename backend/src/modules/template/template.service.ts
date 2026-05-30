import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import * as auditService from "../audit/audit.service";
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateQueryInput,
} from "./template.schema";

function safeParseJson<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

const defaultMuxedOutput = {
  resolution: "1920x1080",
  frameRate: "23.976",
  encoder: "x264",
  encoderPreset: "slow",
  videoBitrate: "8000k",
  targetSize: "1.5GB",
  audioCodec: "AAC",
  audioBitrate: "192k",
  audioChannels: "2.0",
  extraParams: "",
};

const defaultBurnedOutput = {
  resolution: "1920x1080",
  frameRate: "23.976",
  encoder: "x264",
  encoderPreset: "slow",
  videoBitrate: "9000k",
  targetSize: "1.8GB",
  audioCodec: "AAC",
  audioBitrate: "192k",
  audioChannels: "2.0",
  extraParams: "",
};

function normalizeProductConfig(config: Record<string, any> | null | undefined) {
  const source = config ?? {};
  const base = {
    ...defaultMuxedOutput,
    resolution: source.resolution ?? defaultMuxedOutput.resolution,
    encoder: source.encoder ?? defaultMuxedOutput.encoder,
    videoBitrate: source.bitrate ?? defaultMuxedOutput.videoBitrate,
  };

  return {
    namingRule: source.namingRule ?? "{title}_{ep}_{quality}",
    outputs: {
      muxed: { ...base, ...(source.outputs?.muxed ?? {}) },
      burned: { ...defaultBurnedOutput, ...base, ...(source.outputs?.burned ?? {}) },
    },
  };
}

function serializeTemplate(template: {
  id: string;
  name: string;
  description: string | null;
  project_type: string;
  roles: string;
  upload_policy: string;
  notification_policy: string;
  ass_policy: string;
  product_config: string;
  delivery_checklist: string;
  release_task_type: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
  _count?: { projects?: number };
}) {
  return {
    id: template.id,
    name: template.name,
    type: template.project_type,
    description: template.description || undefined,
    roles: safeParseJson(template.roles, []),
    uploadPolicy: safeParseJson(template.upload_policy, { allowedTypes: {} }),
    notificationPolicy: safeParseJson(template.notification_policy, { events: {} }),
    assPolicy: safeParseJson(template.ass_policy, { mergeRule: "default", dedupThreshold: 0.1 }),
    productConfig: normalizeProductConfig(safeParseJson(template.product_config, {})),
    deliveryChecklist: safeParseJson(template.delivery_checklist, []),
    useCount: template._count?.projects ?? 0,
    createdAt: template.created_at.toISOString(),
    updatedAt: template.updated_at.toISOString(),
  };
}

export async function createTemplate(
  data: CreateTemplateInput,
  actorId?: string
) {
  // Validate roles JSON
  let roles: unknown;
  try {
    roles = JSON.parse(data.roles);
  } catch {
    throw new AppError("Invalid roles JSON", "VALIDATION_ERROR", 400);
  }
  if (!Array.isArray(roles)) {
    throw new AppError("Roles must be an array", "VALIDATION_ERROR", 400);
  }

  // If setting as default, unset other defaults for this project type
  if (data.is_default) {
    await prisma.projectTemplate.updateMany({
      where: { project_type: data.project_type },
      data: { is_default: false },
    });
  }

  const template = await prisma.projectTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      project_type: data.project_type,
      roles: data.roles,
      upload_policy: data.upload_policy,
      notification_policy: data.notification_policy,
      ass_policy: data.ass_policy,
      product_config: data.product_config,
      delivery_checklist: data.delivery_checklist,
      release_task_type: data.release_task_type,
      is_default: data.is_default,
    },
  });

  await auditService.log({
    user_id: actorId,
    action: "template.create",
    resource_type: "template",
    resource_id: template.id,
    new_value: template,
  });

  return serializeTemplate(template);
}

export async function getTemplates(query: TemplateQueryInput) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (query.project_type) {
    where.project_type = query.project_type;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { description: { contains: query.search } },
    ];
  }

  const [templates, total] = await Promise.all([
    prisma.projectTemplate.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
      include: {
        _count: { select: { projects: true } },
      },
    }),
    prisma.projectTemplate.count({ where }),
  ]);

  return {
    templates: templates.map(serializeTemplate),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getTemplateById(templateId: string) {
  const template = await prisma.projectTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new AppError("Template not found", "NOT_FOUND", 404);
  }

  return serializeTemplate(template);
}

export async function updateTemplate(
  templateId: string,
  data: UpdateTemplateInput,
  actorId?: string
) {
  const existing = await prisma.projectTemplate.findUnique({
    where: { id: templateId },
  });

  if (!existing) {
    throw new AppError("Template not found", "NOT_FOUND", 404);
  }

  // Validate roles JSON if provided
  if (data.roles !== undefined) {
    let roles: unknown;
    try {
      roles = JSON.parse(data.roles);
    } catch {
      throw new AppError("Invalid roles JSON", "VALIDATION_ERROR", 400);
    }
    if (!Array.isArray(roles)) {
      throw new AppError("Roles must be an array", "VALIDATION_ERROR", 400);
    }
  }

  // If setting as default, unset other defaults for this project type
  if (data.is_default && data.project_type) {
    await prisma.projectTemplate.updateMany({
      where: {
        project_type: data.project_type,
        id: { not: templateId },
      },
      data: { is_default: false },
    });
  }

  const template = await prisma.projectTemplate.update({
    where: { id: templateId },
    data: {
      name: data.name,
      description: data.description,
      project_type: data.project_type,
      roles: data.roles,
      upload_policy: data.upload_policy,
      notification_policy: data.notification_policy,
      ass_policy: data.ass_policy,
      product_config: data.product_config,
      delivery_checklist: data.delivery_checklist,
      release_task_type: data.release_task_type,
      is_default: data.is_default,
    },
  });

  await auditService.log({
    user_id: actorId,
    action: "template.update",
    resource_type: "template",
    resource_id: templateId,
    old_value: existing,
    new_value: template,
  });

  return serializeTemplate(template);
}

export async function deleteTemplate(
  templateId: string,
  actorId?: string
) {
  const existing = await prisma.projectTemplate.findUnique({
    where: { id: templateId },
    include: {
      projects: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!existing) {
    throw new AppError("Template not found", "NOT_FOUND", 404);
  }

  // Hard delete if unused, otherwise prevent deletion
  if (existing.projects.length > 0) {
    throw new AppError(
      "Cannot delete template that is in use by projects. Template modifications do not affect existing projects.",
      "CONFLICT",
      409
    );
  }

  await prisma.projectTemplate.delete({
    where: { id: templateId },
  });

  await auditService.log({
    user_id: actorId,
    action: "template.delete",
    resource_type: "template",
    resource_id: templateId,
    old_value: existing,
  });

  return { success: true };
}

export async function setDefaultTemplate(
  templateId: string,
  actorId?: string
) {
  const template = await prisma.projectTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new AppError("Template not found", "NOT_FOUND", 404);
  }

  // Unset other defaults for this project type
  await prisma.projectTemplate.updateMany({
    where: {
      project_type: template.project_type,
      id: { not: templateId },
    },
    data: { is_default: false },
  });

  const updated = await prisma.projectTemplate.update({
    where: { id: templateId },
    data: { is_default: true },
  });

  await auditService.log({
    user_id: actorId,
    action: "template.set_default",
    resource_type: "template",
    resource_id: templateId,
    new_value: updated,
  });

  return serializeTemplate(updated);
}
