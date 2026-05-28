import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateQueryInput,
} from "./template.schema";

export async function createTemplate(data: CreateTemplateInput) {
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
      is_default: data.is_default,
    },
  });

  return template;
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
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [templates, total] = await Promise.all([
    prisma.projectTemplate.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
    }),
    prisma.projectTemplate.count({ where }),
  ]);

  return {
    templates,
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

  return template;
}

export async function updateTemplate(
  templateId: string,
  data: UpdateTemplateInput
) {
  if (data.is_default && data.project_type) {
    await prisma.projectTemplate.updateMany({
      where: { project_type: data.project_type },
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
      is_default: data.is_default,
    },
  });

  return template;
}

export async function deleteTemplate(templateId: string) {
  await prisma.projectTemplate.delete({
    where: { id: templateId },
  });

  return { success: true };
}
