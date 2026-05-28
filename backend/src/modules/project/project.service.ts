import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  CreateProjectInput,
  UpdateProjectInput,
  AddMemberInput,
  UpdateMemberInput,
  CreateUnitInput,
  JoinRequestInput,
  ProjectQueryInput,
} from "./project.schema";

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

  // Auto-add owner as project manager
  await prisma.projectMember.create({
    data: {
      project_id: project.id,
      user_id: ownerId,
      role: "project_manager",
      is_lead: true,
    },
  });

  return project;
}

export async function getProjects(query: ProjectQueryInput, userId: string) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {
    deleted_at: null,
  };

  if (!query.include_archived) {
    where.is_archived = false;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.project_type) {
    where.project_type = query.project_type;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
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
  data: UpdateProjectInput
) {
  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      name: data.name,
      description: data.description,
      status: data.status,
      current_season: data.current_season,
    },
  });

  return project;
}

export async function deleteProject(projectId: string) {
  await prisma.project.update({
    where: { id: projectId },
    data: {
      deleted_at: new Date(),
      status: "cancelled",
    },
  });

  return { success: true };
}

export async function archiveProject(projectId: string) {
  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      is_archived: true,
      archived_at: new Date(),
      status: "archived",
    },
  });

  return project;
}

export async function addMember(projectId: string, data: AddMemberInput) {
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

  return member;
}

export async function removeMember(projectId: string, userId: string) {
  await prisma.projectMember.delete({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: userId,
      },
    },
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

export async function createUnit(projectId: string, data: CreateUnitInput) {
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

  return unit;
}

export async function createJoinRequest(
  projectId: string,
  userId: string,
  data: JoinRequestInput
) {
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

  return request;
}

export async function respondToJoinRequest(
  requestId: string,
  approverId: string,
  approved: boolean
) {
  const request = await prisma.joinRequest.update({
    where: { id: requestId },
    data: {
      approved,
      approved_by: approverId,
      approved_at: new Date(),
    },
  });

  if (approved) {
    await prisma.projectMember.create({
      data: {
        project_id: request.project_id,
        user_id: request.user_id,
        role: request.role,
      },
    });
  }

  return request;
}
