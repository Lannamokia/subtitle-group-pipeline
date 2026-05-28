import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import type {
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  AnnouncementQueryInput,
} from "./announcement.schema";

export async function createAnnouncement(
  creatorId: string,
  data: CreateAnnouncementInput
) {
  const announcement = await prisma.announcement.create({
    data: {
      type: data.type,
      project_id: data.project_id,
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

  return announcement;
}

export async function getAnnouncements(query: AnnouncementQueryInput) {
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
  data: UpdateAnnouncementInput
) {
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
    },
  });

  return announcement;
}

export async function deleteAnnouncement(announcementId: string) {
  await prisma.announcement.delete({
    where: { id: announcementId },
  });

  return { success: true };
}
