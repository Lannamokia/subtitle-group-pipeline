import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { TimelineEventType } from "@prisma/client";
import * as timelineService from "../timeline/timeline.service";
import type {
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  AnnouncementQueryInput,
} from "./announcement.schema";

export async function createGlobalAnnouncement(
  creatorId: string,
  data: CreateAnnouncementInput
) {
  if (data.type !== "global") {
    throw new AppError("Use createProjectAnnouncement for project announcements", "BAD_REQUEST", 400);
  }

  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { role: true },
  });

  const canCreateGlobal =
    creator?.role === "super_admin" ||
    creator?.role === "group_admin" ||
    creator?.role === "supervisor";

  if (!canCreateGlobal) {
    throw new AppError("Only supervisors or admins can create global announcements", "FORBIDDEN", 403);
  }

  const announcement = await prisma.announcement.create({
    data: {
      type: "global",
      title: data.title,
      content: data.content,
      is_pinned: data.is_pinned,
      expires_at: data.expires_at ? new Date(data.expires_at) : null,
      created_by: creatorId,
    },
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  return announcement;
}

export async function createProjectAnnouncement(
  creatorId: string,
  data: CreateAnnouncementInput
) {
  if (data.type !== "project") {
    throw new AppError("Announcement type must be 'project'", "BAD_REQUEST", 400);
  }

  if (!data.project_id) {
    throw new AppError("project_id is required for project announcements", "BAD_REQUEST", 400);
  }
  const projectId = data.project_id;

  // Verify creator is a member of the project
  const membership = await prisma.projectMember.findUnique({
    where: {
      project_id_user_id: {
        project_id: projectId,
        user_id: creatorId,
      },
    },
  });

  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { role: true },
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { owner_id: true },
  });

  const isSupervisor = membership?.is_lead || membership?.role === "supervisor";
  const isAdmin = creator?.role === "super_admin" || creator?.role === "group_admin";
  const isOwner = project?.owner_id === creatorId;

  if (!isSupervisor && !isAdmin && !isOwner) {
    throw new AppError("Only project supervisors or admins can create project announcements", "FORBIDDEN", 403);
  }

  const announcement = await prisma.announcement.create({
    data: {
      type: "project",
      project_id: projectId,
      title: data.title,
      content: data.content,
      is_pinned: data.is_pinned,
      expires_at: data.expires_at ? new Date(data.expires_at) : null,
      created_by: creatorId,
    },
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  await timelineService.createTimelineEvent({
    project_id: projectId,
    event_type: TimelineEventType.announcement,
    title: "Project announcement",
    description: announcement.title,
    actor_id: creatorId,
    metadata: { announcement_id: announcement.id },
  });

  return announcement;
}

export async function getAnnouncements(query: AnnouncementQueryInput, userId?: string) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (!query.include_inactive) {
    where.is_active = true;
  }

  if (query.type) {
    where.type = query.type;
  }

  if (query.project_id) {
    where.project_id = query.project_id;
  }

  // For non-admin users, filter out expired announcements
  if (!query.include_inactive) {
    where.OR = [
      { expires_at: null },
      { expires_at: { gt: new Date() } },
    ];
  }

  const [announcements, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: [
        { is_pinned: "desc" },
        { created_at: "desc" },
      ],
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            nickname: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.announcement.count({ where }),
  ]);

  return {
    announcements,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getAnnouncementById(announcementId: string) {
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!announcement) {
    throw new AppError("Announcement not found", "NOT_FOUND", 404);
  }

  return announcement;
}

export async function updateAnnouncement(
  announcementId: string,
  userId: string,
  userRole: string,
  data: UpdateAnnouncementInput
) {
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
  });

  if (!existing) {
    throw new AppError("Announcement not found", "NOT_FOUND", 404);
  }

  // Check permissions
  const isOwner = existing.created_by === userId;
  const isAdmin = userRole === "super_admin" || userRole === "group_admin";

  if (!isOwner && !isAdmin) {
    throw new AppError("You can only edit your own announcements", "FORBIDDEN", 403);
  }

  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.is_pinned !== undefined) updateData.is_pinned = data.is_pinned;
  if (data.is_active !== undefined) updateData.is_active = data.is_active;
  if (data.expires_at !== undefined) {
    updateData.expires_at = data.expires_at ? new Date(data.expires_at) : null;
  }

  const announcement = await prisma.announcement.update({
    where: { id: announcementId },
    data: updateData,
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return announcement;
}

export async function deleteAnnouncement(
  announcementId: string,
  userId: string,
  userRole: string
) {
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
  });

  if (!existing) {
    throw new AppError("Announcement not found", "NOT_FOUND", 404);
  }

  const isOwner = existing.created_by === userId;
  const isAdmin = userRole === "super_admin" || userRole === "group_admin";

  if (!isOwner && !isAdmin) {
    throw new AppError("You can only delete your own announcements", "FORBIDDEN", 403);
  }

  await prisma.announcement.delete({
    where: { id: announcementId },
  });

  return { success: true };
}

export async function pinAnnouncement(
  announcementId: string,
  userId: string,
  userRole: string,
  pinned: boolean
) {
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
  });

  if (!existing) {
    throw new AppError("Announcement not found", "NOT_FOUND", 404);
  }

  const isOwner = existing.created_by === userId;
  const isAdmin = userRole === "super_admin" || userRole === "group_admin";

  if (!isOwner && !isAdmin) {
    throw new AppError("You can only pin your own announcements", "FORBIDDEN", 403);
  }

  const announcement = await prisma.announcement.update({
    where: { id: announcementId },
    data: { is_pinned: pinned },
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  return announcement;
}
