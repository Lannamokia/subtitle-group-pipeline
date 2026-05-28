import { prisma } from "../../config/database";
import { TimelineEventType } from "@prisma/client";

export interface CreateTimelineEventInput {
  project_id: string;
  event_type: TimelineEventType;
  title: string;
  description?: string;
  actor_id?: string;
  metadata?: Record<string, unknown>;
}

export async function createTimelineEvent(data: CreateTimelineEventInput) {
  const event = await prisma.timelineEvent.create({
    data: {
      project_id: data.project_id,
      event_type: data.event_type,
      title: data.title,
      description: data.description,
      actor_id: data.actor_id,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    },
    include: {
      actor: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar_url: true,
        },
      },
    },
  });

  return event;
}

export async function getProjectTimeline(
  projectId: string,
  options: {
    page?: number;
    pageSize?: number;
    event_type?: TimelineEventType;
  } = {}
) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {
    project_id: projectId,
  };

  if (options.event_type) {
    where.event_type = options.event_type;
  }

  const [events, total] = await Promise.all([
    prisma.timelineEvent.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { occurred_at: "desc" },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar_url: true,
          },
        },
      },
    }),
    prisma.timelineEvent.count({ where }),
  ]);

  return {
    events,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getGlobalTimeline(
  userId: string,
  options: {
    page?: number;
    pageSize?: number;
  } = {}
) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const skip = (page - 1) * pageSize;

  // Get all projects the user is a member of
  const memberships = await prisma.projectMember.findMany({
    where: { user_id: userId },
    select: { project_id: true },
  });

  const projectIds = memberships.map((m) => m.project_id);

  if (projectIds.length === 0) {
    return {
      events: [],
      meta: {
        page,
        pageSize,
        total: 0,
        totalPages: 0,
      },
    };
  }

  const [events, total] = await Promise.all([
    prisma.timelineEvent.findMany({
      where: {
        project_id: { in: projectIds },
      },
      skip,
      take: pageSize,
      orderBy: { occurred_at: "desc" },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar_url: true,
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
    prisma.timelineEvent.count({
      where: {
        project_id: { in: projectIds },
      },
    }),
  ]);

  return {
    events,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
