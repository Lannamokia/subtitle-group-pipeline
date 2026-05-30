import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { TaskRole, TaskStatus, ProjectStatus, TimelineEventType } from "@prisma/client";
import * as auditService from "../audit/audit.service";
import * as timelineService from "../timeline/timeline.service";
import * as notificationService from "../notification/notification.service";
import { permanentlyDeleteProjectById } from "../../jobs/recyclebin.cleanup";
import type {
  CreateProjectInput,
  CreateProjectFromTemplateInput,
  UpdateProjectInput,
  AddMemberInput,
  UpdateMemberInput,
  CreateUnitInput,
  UpdateProjectUnitsInput,
  JoinRequestInput,
  ProjectQueryInput,
  UpdateJoinRequestInput,
} from "./project.schema";

// Serial pipeline order for task creation
const ROLE_PIPELINE: TaskRole[] = [
  "source",
  "timing",
  "translation",
  "post_production",
  "encoding",
  "release",
];

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function numberFromPolicy(policy: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = policy[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

async function getProjectSupervisorRecipientIds(projectId: string, actorId?: string): Promise<string[]> {
  const [project, supervisors] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { owner_id: true },
    }),
    prisma.projectMember.findMany({
      where: {
        project_id: projectId,
        OR: [{ role: "supervisor" }, { is_lead: true }],
      },
      select: { user_id: true },
    }),
  ]);

  return [
    ...new Set([
      ...(project?.owner_id ? [project.owner_id] : []),
      ...supervisors.map((member) => member.user_id),
    ]),
  ].filter((userId) => userId !== actorId);
}

function booleanFromPolicy(policy: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = policy[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function stringifyPolicyList(policy: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = policy[key];
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }
  }
  return null;
}

function parseTemplateRoles(project: { workflow_config: string | null; template?: { roles: string } | null }) {
  const rawRoles = project.workflow_config ?? project.template?.roles ?? "[]";
  try {
    return JSON.parse(rawRoles) as Array<{
      role: TaskRole;
      enabled: boolean;
      slotCount: number;
      assignmentStrategy: "manual" | "open_claim";
    }>;
  } catch {
    return [];
  }
}

async function createTemplateTasksForUnit(
  projectId: string,
  unit: { id: string; season_number: number; unit_number: number; title: string | null },
  ownerId: string,
  roles: Array<{
    role: TaskRole;
    enabled: boolean;
    slotCount: number;
    assignmentStrategy: "manual" | "open_claim";
  }>
) {
  const enabledRoles = roles.filter((role) => role.enabled).map((role) => role.role);
  let previousTaskId: string | null = null;

  for (const role of ROLE_PIPELINE) {
    if (!enabledRoles.includes(role)) continue;

    const roleConfig = roles.find((config) => config.role === role);
    const slotCount = roleConfig?.slotCount || 1;
    const assignmentStrategy = roleConfig?.assignmentStrategy || "manual";
    const initialStatus: TaskStatus =
      assignmentStrategy === "open_claim" ? "claimable" : "pending_publish";

    for (let slot = 0; slot < slotCount; slot++) {
      const task = await prisma.task.create({
        data: {
          project_id: projectId,
          unit_id: unit.id,
          title: `${role.replace("_", " ")} - ${unit.title || `S${unit.season_number}E${unit.unit_number}`}${slotCount > 1 ? ` (${slot + 1})` : ""}`,
          description: `Task for ${role} on ${unit.title || `S${unit.season_number}E${unit.unit_number}`}`,
          role,
          status: initialStatus,
          creator_id: ownerId,
        },
      });

      if (previousTaskId) {
        await prisma.taskDependency.create({
          data: {
            task_id: task.id,
            depends_on_id: previousTaskId,
            dependency_type: "finish_to_start",
          },
        });
      }

      previousTaskId = task.id;
    }
  }
}

export async function createProject(
  ownerId: string,
  data: CreateProjectInput
) {
  const project = await prisma.project.create({
    data: {
      name: data.name,
      description: data.description,
      project_type: data.project_type,
      owner_id: ownerId,
      template_id: data.template_id,
      storage_backend_id: data.storage_backend_id,
      qq_group_id: data.qq_group_id,
      status: "draft",
    },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  // Auto-add owner as supervisor
  await prisma.projectMember.create({
    data: {
      project_id: project.id,
      user_id: ownerId,
      role: "supervisor",
      is_lead: true,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: project.id,
    event_type: TimelineEventType.project_created,
    title: "项目已创建",
    description: `项目「${project.name}」已创建`,
    actor_id: ownerId,
  });

  await auditService.log({
    user_id: ownerId,
    action: "project.create",
    resource_type: "project",
    resource_id: project.id,
    new_value: project,
  });

  return project;
}

export async function createProjectFromTemplate(
  ownerId: string,
  data: CreateProjectFromTemplateInput
) {
  const template = await prisma.projectTemplate.findUnique({
    where: { id: data.template_id },
  });

  if (!template) {
    throw new AppError("Template not found", "NOT_FOUND", 404);
  }

  const backend = await prisma.storageBackend.findUnique({
    where: { id: data.storage_backend_id },
  });
  if (!backend) {
    throw new AppError("Storage backend not found", "NOT_FOUND", 404);
  }
  if (!backend.is_active) {
    throw new AppError("Storage backend is not active", "BAD_REQUEST", 400);
  }

  // Parse template roles
  let templateRoles: Array<{
    role: TaskRole;
    enabled: boolean;
    slotCount: number;
    assignmentStrategy: "manual" | "open_claim";
    maxSegmentLength?: number;
    requiredTagIds?: string[];
  }> = [];
  try {
    templateRoles = JSON.parse(template.roles);
  } catch {
    templateRoles = [];
  }

  // Create project (inherit delivery checklist from template)
  const project = await prisma.project.create({
    data: {
      name: data.name,
      description: data.description,
      project_type: template.project_type,
      owner_id: ownerId,
      template_id: template.id,
      storage_backend_id: data.storage_backend_id,
      qq_group_id: data.qq_group_id,
      workflow_config: template.roles,
      upload_policy_config: template.upload_policy,
      notification_policy: template.notification_policy,
      ass_policy: template.ass_policy,
      product_config: template.product_config,
      delivery_checklist: template.delivery_checklist,
      release_task_type: template.release_task_type,
      status: "draft",
    },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  // Add owner as supervisor
  await prisma.projectMember.create({
    data: {
      project_id: project.id,
      user_id: ownerId,
      role: "supervisor",
      is_lead: true,
    },
  });

  const uploadPolicy = parseJsonObject(template.upload_policy);
  await prisma.uploadPolicy.create({
    data: {
      project_id: project.id,
      allowed_types: template.upload_policy,
      max_size_bytes: numberFromPolicy(uploadPolicy, "max_size_bytes", "maxSize") ?? 104857600,
      require_approval: booleanFromPolicy(uploadPolicy, "require_approval", "requireApproval") ?? false,
      extension_whitelist: stringifyPolicyList(uploadPolicy, "extension_whitelist", "extensionWhitelist", "extensions"),
    },
  });

  // Create project units for each season
  const units: Array<{ id: string; season_number: number; unit_number: number; title: string | null }> = [];
  for (let season = 1; season <= data.season_count; season++) {
    for (let unitNum = 1; unitNum <= data.units_per_season; unitNum++) {
      const unitTitle = season === 1 ? `Episode ${unitNum}` : `Season ${season} Episode ${unitNum}`;
      const unit = await prisma.projectUnit.create({
        data: {
          project_id: project.id,
          season_number: season,
          unit_number: unitNum,
          title: unitTitle,
          episode_length: data.episode_length,
        },
      });
      units.push(unit);
    }
  }

  // Create task graph for each unit based on template roles
  for (const unit of units) {
    await createTemplateTasksForUnit(project.id, unit, ownerId, templateRoles);
  }

  await timelineService.createTimelineEvent({
    project_id: project.id,
    event_type: TimelineEventType.project_created,
    title: "项目已从模板创建",
    description: `项目「${project.name}」已从模板「${template.name}」创建`,
    actor_id: ownerId,
    metadata: { template_id: template.id },
  });

  await auditService.log({
    user_id: ownerId,
    action: "project.create_from_template",
    resource_type: "project",
    resource_id: project.id,
    new_value: { project, template_id: template.id },
  });

  return project;
}

export async function getProjects(query: ProjectQueryInput, userId?: string) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (!query.include_deleted) {
    where.deleted_at = null;
  }

  if (!query.include_archived) {
    where.is_archived = false;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.project_type) {
    where.project_type = query.project_type;
  }

  if (query.supervisor_id) {
    where.members = {
      some: {
        user_id: query.supervisor_id,
        role: "supervisor",
      },
    };
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { description: { contains: query.search } },
    ];
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar_url: true,
          },
        },
        _count: {
          select: {
            members: true,
            tasks: true,
            units: true,
          },
        },
      },
    }),
    prisma.project.count({ where }),
  ]);

  return {
    projects,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getProjectById(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
      template: {
        select: {
          id: true,
          name: true,
          roles: true,
          upload_policy: true,
          product_config: true,
          notification_policy: true,
          ass_policy: true,
          delivery_checklist: true,
          release_task_type: true,
        },
      },
      storage_backend: {
        select: {
          id: true,
          name: true,
          backend_type: true,
        },
      },
      members: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar_url: true,
            },
          },
        },
      },
      units: {
        orderBy: [
          { season_number: "asc" },
          { unit_number: "asc" },
        ],
      },
      tasks: {
        include: {
          assignee: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar_url: true,
            },
          },
          dependencies: {
            include: {
              depends_on: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: { created_at: "asc" },
      },
      _count: {
        select: {
          tasks: true,
          files: true,
        },
      },
    },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  return project;
}

export async function updateProject(
  projectId: string,
  data: UpdateProjectInput,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (existing.deleted_at) {
    throw new AppError("Cannot update a deleted project", "BAD_REQUEST", 400);
  }

  const updateData: Record<string, unknown> = {
    name: data.name,
    description: data.description,
    status: data.status,
    current_season: data.current_season,
    qq_group_id: data.qq_group_id,
  };
  if (data.delivery_checklist !== undefined) {
    updateData.delivery_checklist = JSON.stringify(data.delivery_checklist);
  }
  if (data.download_link_ttl_seconds !== undefined) {
    updateData.download_link_ttl_seconds = data.download_link_ttl_seconds;
  }
  if (data.wiki_approval_required !== undefined) {
    updateData.wiki_approval_required = data.wiki_approval_required;
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: updateData,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.update",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function archiveProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (existing.deleted_at) {
    throw new AppError("Cannot archive a deleted project", "BAD_REQUEST", 400);
  }

  if (existing.is_archived) {
    throw new AppError("Project is already archived", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      is_archived: true,
      archived_at: new Date(),
      status: "archived",
    },
  });

  // Freeze all active tasks
  await prisma.task.updateMany({
    where: {
      project_id: projectId,
      status: { in: ["in_progress", "submitted", "claimable", "assigned"] },
    },
    data: {
      status: "frozen",
      frozen_at: new Date(),
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_archived,
    title: "项目已归档",
    description: `项目「${project.name}」已归档`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.archive",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function unarchiveProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.is_archived) {
    throw new AppError("Project is not archived", "BAD_REQUEST", 400);
  }

  if (existing.deleted_at) {
    throw new AppError("Cannot unarchive a deleted project", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      is_archived: false,
      archived_at: null,
      status: "active",
    },
  });

  // Unfreeze tasks that were frozen during archive
  await prisma.task.updateMany({
    where: {
      project_id: projectId,
      status: "frozen",
    },
    data: {
      status: "claimable",
      frozen_at: null,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_unarchived,
    title: "项目已取消归档",
    description: `项目「${project.name}」已从归档恢复`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.unarchive",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function softDeleteProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.is_archived) {
    throw new AppError(
      "Project must be archived before it can be deleted",
      "BAD_REQUEST",
      400
    );
  }

  if (existing.deleted_at) {
    throw new AppError("Project is already deleted", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      deleted_at: new Date(),
      status: "deleted",
    },
  });

  // Create recycle bin record
  await prisma.recycleBinRecord.create({
    data: {
      user_id: actorId || existing.owner_id,
      resource_type: "project",
      resource_id: projectId,
      resource_data: JSON.stringify(existing),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_deleted,
    title: "项目已移入回收站",
    description: `项目「${project.name}」已移入回收站`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.soft_delete",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function restoreProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.deleted_at) {
    throw new AppError("Project is not in recycle bin", "BAD_REQUEST", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      deleted_at: null,
      status: "archived",
      is_archived: true,
    },
  });

  // Mark recycle bin record as restored
  await prisma.recycleBinRecord.updateMany({
    where: {
      resource_type: "project",
      resource_id: projectId,
      restored_at: null,
    },
    data: {
      restored_at: new Date(),
      restored_by: actorId,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.project_restored,
    title: "项目已从回收站恢复",
    description: `项目「${project.name}」已从回收站恢复`,
    actor_id: actorId,
  });

  await auditService.log({
    user_id: actorId,
    action: "project.restore",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
    new_value: project,
  });

  return project;
}

export async function permanentlyDeleteProject(
  projectId: string,
  actorId?: string
) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!existing) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (!existing.deleted_at) {
    throw new AppError("Project is not in recycle bin", "BAD_REQUEST", 400);
  }

  await auditService.log({
    user_id: actorId,
    action: "project.permanent_delete",
    resource_type: "project",
    resource_id: projectId,
    old_value: existing,
  });

  await permanentlyDeleteProjectById(projectId);

  return { deleted: true, id: projectId };
}

export async function getProjectMembers(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  const members = await prisma.projectMember.findMany({
    where: { project_id: projectId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
    orderBy: { joined_at: "asc" },
  });

  return members;
}

export async function addMember(
  projectId: string,
  data: AddMemberInput,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot modify archived project", "BAD_REQUEST", 400);
  }

  const existing = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: data.user_id,
      },
    },
  });

  if (existing) {
    throw new AppError("User is already a member", "DUPLICATE_ERROR", 409);
  }

  const member = await prisma.projectMember.create({
    data: {
      project_id: projectId,
      user_id: data.user_id,
      role: data.role,
      is_lead: data.is_lead,
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.member_added,
    title: "Member added",
    description: `${member.user.nickname || member.user.username} joined as ${data.role}`,
    actor_id: actorId,
    metadata: { user_id: data.user_id, role: data.role },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.add_member",
    resource_type: "project",
    resource_id: projectId,
    new_value: member,
  });

  return member;
}

export async function removeMember(
  projectId: string,
  userId: string,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot modify archived project", "BAD_REQUEST", 400);
  }

  const member = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  if (!member) {
    throw new AppError("Member not found", "NOT_FOUND", 404);
  }

  // Unassign any tasks assigned to this member
  await prisma.task.updateMany({
    where: {
      project_id: projectId,
      assignee_id: userId,
    },
    data: {
      assignee_id: null,
      status: "claimable",
    },
  });

  await prisma.projectMember.delete({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.member_removed,
    title: "Member removed",
    description: `${member.user.nickname || member.user.username} was removed from the project`,
    actor_id: actorId,
    metadata: { user_id: userId },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.remove_member",
    resource_type: "project",
    resource_id: projectId,
    old_value: member,
  });

  return { success: true };
}

export async function updateMember(
  projectId: string,
  userId: string,
  data: UpdateMemberInput
) {
  const member = await prisma.projectMember.update({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
    data: {
      role: data.role,
      is_lead: data.is_lead,
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  return member;
}

export async function createUnit(
  projectId: string,
  data: CreateUnitInput,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  const unit = await prisma.projectUnit.create({
    data: {
      project_id: projectId,
      season_number: data.season_number,
      unit_number: data.unit_number,
      title: data.title,
      episode_length: data.episode_length,
      air_date: data.air_date ? new Date(data.air_date) : null,
      description: data.description,
    },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.create_unit",
    resource_type: "project",
    resource_id: projectId,
    new_value: unit,
  });

  return unit;
}

export async function updateProjectUnits(
  projectId: string,
  data: UpdateProjectUnitsInput,
  actorId?: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    include: { template: { select: { roles: true } } },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot change units in archived project", "BAD_REQUEST", 400);
  }

  const existingUnits = await prisma.projectUnit.findMany({
    where: { project_id: projectId, season_number: data.season_number },
    include: { _count: { select: { tasks: true, claims: true } } },
    orderBy: { unit_number: "asc" },
  });

  const existingByNumber = new Map(existingUnits.map((unit) => [unit.unit_number, unit]));
  const unitsToDelete = existingUnits.filter((unit) => unit.unit_number > data.units_per_season);
  const unitIdsToDelete = unitsToDelete.map((unit) => unit.id);
  const tasksToDelete = unitIdsToDelete.length > 0
    ? await prisma.task.findMany({
        where: { unit_id: { in: unitIdsToDelete } },
        include: {
          _count: {
            select: {
              claims: true,
              submissions: true,
              reviews: true,
              comments: true,
              notifications: true,
            },
          },
        },
      })
    : [];
  const blockingTask = tasksToDelete.find((task) =>
    Boolean(task.assignee_id) ||
    !["pending_publish", "claimable"].includes(task.status) ||
    Boolean(task.started_at || task.submitted_at || task.completed_at || task.cancelled_at || task.frozen_at) ||
    task._count.claims > 0 ||
    task._count.submissions > 0 ||
    task._count.reviews > 0 ||
    task._count.comments > 0 ||
    task._count.notifications > 0
  );

  if (blockingTask || unitsToDelete.some((unit) => unit._count.claims > 0)) {
    throw new AppError(
      "Cannot reduce episode count because removed episodes already contain active work",
      "BAD_REQUEST",
      400
    );
  }

  const roles = parseTemplateRoles(project);
  const createdUnits: Array<{ id: string; season_number: number; unit_number: number; title: string | null }> = [];

  await prisma.$transaction(async (tx) => {
    if (unitsToDelete.length > 0) {
      const taskIdsToDelete = tasksToDelete.map((task) => task.id);
      if (taskIdsToDelete.length > 0) {
        await tx.taskDependency.deleteMany({
          where: {
            OR: [
              { task_id: { in: taskIdsToDelete } },
              { depends_on_id: { in: taskIdsToDelete } },
            ],
          },
        });
        await tx.task.deleteMany({
          where: { id: { in: taskIdsToDelete } },
        });
      }
      await tx.projectUnit.deleteMany({
        where: { id: { in: unitsToDelete.map((unit) => unit.id) } },
      });
    }

    for (let unitNumber = 1; unitNumber <= data.units_per_season; unitNumber++) {
      if (existingByNumber.has(unitNumber)) continue;

      const unitTitle =
        data.season_number === 1
          ? `Episode ${unitNumber}`
          : `Season ${data.season_number} Episode ${unitNumber}`;
      const unit = await tx.projectUnit.create({
        data: {
          project_id: projectId,
          season_number: data.season_number,
          unit_number: unitNumber,
          title: unitTitle,
          episode_length: data.episode_length,
        },
      });
      createdUnits.push(unit);
    }
  });

  for (const unit of createdUnits) {
    await createTemplateTasksForUnit(projectId, unit, project.owner_id, roles);
  }

  if (data.episode_length !== undefined && data.episode_length !== null) {
    await prisma.projectUnit.updateMany({
      where: { project_id: projectId, season_number: data.season_number },
      data: { episode_length: data.episode_length },
    });
  }

  const units = await prisma.projectUnit.findMany({
    where: { project_id: projectId, season_number: data.season_number },
    orderBy: { unit_number: "asc" },
    include: { _count: { select: { tasks: true } } },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.custom,
    title: "分集数量已调整",
    description: `第 ${data.season_number} 季分集数量调整为 ${data.units_per_season} 集`,
    actor_id: actorId,
    metadata: { season_number: data.season_number, units_per_season: data.units_per_season },
  });

  await auditService.log({
    user_id: actorId,
    action: "project.update_units",
    resource_type: "project",
    resource_id: projectId,
    old_value: { units: existingUnits.map((unit) => unit.unit_number) },
    new_value: { units: units.map((unit) => unit.unit_number) },
  });

  return units;
}

export async function createJoinRequest(
  projectId: string,
  userId: string,
  data: JoinRequestInput
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
  });

  if (!project) {
    throw new AppError("Project not found", "NOT_FOUND", 404);
  }

  if (project.is_archived) {
    throw new AppError("Cannot join archived project", "BAD_REQUEST", 400);
  }

  // Check if already a member
  const existingMember = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
  });

  if (existingMember) {
    throw new AppError("You are already a member", "DUPLICATE_ERROR", 409);
  }

  const existing = await prisma.joinRequest.findFirst({
    where: {
      project_id: projectId,
      user_id: userId,
      approved: null,
    },
  });

  if (existing) {
    throw new AppError(
      "You already have a pending join request",
      "DUPLICATE_ERROR",
      409
    );
  }

  const request = await prisma.joinRequest.create({
    data: {
      project_id: projectId,
      user_id: userId,
      role: data.role,
      message: data.message,
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.join_request_created,
    title: "Join request created",
    description: `A new join request was submitted for role ${data.role}`,
    actor_id: userId,
    metadata: { role: data.role },
  });

  const recipients = await getProjectSupervisorRecipientIds(projectId, userId);
  for (const recipientId of recipients) {
    await notificationService.createNotification(recipientId, "join_request", {
      projectId,
      actorId: userId,
      projectName: project.name,
      actorName: "申请人",
      reason: data.message || undefined,
    });
  }

  return request;
}

export async function respondToJoinRequest(
  requestId: string,
  approverId: string,
  data: UpdateJoinRequestInput
) {
  const request = await prisma.joinRequest.findUnique({
    where: { id: requestId },
    include: {
      project: { select: { name: true } },
      user: { select: { username: true, nickname: true } },
    },
  });

  if (!request) {
    throw new AppError("Join request not found", "NOT_FOUND", 404);
  }

  if (request.approved !== null) {
    throw new AppError("Join request has already been processed", "BAD_REQUEST", 400);
  }

  const updated = await prisma.joinRequest.update({
    where: { id: requestId },
    data: {
      approved: data.approved,
      approved_by: approverId,
      approved_at: new Date(),
    },
  });

  if (data.approved) {
    await prisma.projectMember.create({
      data: {
        project_id: request.project_id,
        user_id: request.user_id,
        role: request.role,
      },
    });

    await timelineService.createTimelineEvent({
      project_id: request.project_id,
      event_type: TimelineEventType.join_request_approved,
      title: "Join request approved",
      description: `Join request for role ${request.role} was approved`,
      actor_id: approverId,
      metadata: { user_id: request.user_id, role: request.role },
    });
  } else {
    await timelineService.createTimelineEvent({
      project_id: request.project_id,
      event_type: TimelineEventType.join_request_rejected,
      title: "Join request rejected",
      description: `Join request for role ${request.role} was rejected`,
      actor_id: approverId,
      metadata: { user_id: request.user_id, role: request.role },
    });
  }

  const applicantName = request.user.nickname || request.user.username;
  await notificationService.createNotification(
    request.user_id,
    data.approved ? "join_approved" : "join_rejected",
    {
      projectId: request.project_id,
      actorId: approverId,
      projectName: request.project.name,
    }
  );
  await notificationService.createNotification(
    approverId,
    data.approved ? "join_approved" : "join_rejected",
    {
      projectId: request.project_id,
      actorId: approverId,
      projectName: request.project.name,
      actorName: applicantName,
    }
  );

  await auditService.log({
    user_id: approverId,
    action: data.approved ? "project.approve_join" : "project.reject_join",
    resource_type: "join_request",
    resource_id: requestId,
    new_value: updated,
  });

  return updated;
}

export async function getJoinRequests(projectId: string) {
  const requests = await prisma.joinRequest.findMany({
    where: { project_id: projectId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
    orderBy: { created_at: "desc" },
  });

  return requests;
}
