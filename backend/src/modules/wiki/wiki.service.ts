import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { TimelineEventType } from "@prisma/client";
import * as timelineService from "../timeline/timeline.service";
import * as auditService from "../audit/audit.service";
import type {
  CreateWikiInput,
  UpdateWikiInput,
  WikiQueryInput,
  ApproveWikiInput,
  CreateCommentInput,
} from "./wiki.schema";

export async function createWiki(
  creatorId: string,
  data: CreateWikiInput
) {
  const existing = await prisma.wikiDocument.findFirst({
    where: {
      project_id: data.project_id ?? null,
      slug: data.slug,
    },
  });

  if (existing) {
    throw new AppError(
      "A wiki document with this slug already exists",
      "DUPLICATE_ERROR",
      409
    );
  }

  const wiki = await prisma.wikiDocument.create({
    data: {
      project_id: data.project_id ?? null,
      title: data.title,
      slug: data.slug,
      content: data.content,
      status: data.status,
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

  if (data.project_id) {
    await timelineService.createTimelineEvent({
      project_id: data.project_id,
      event_type: TimelineEventType.wiki_updated,
      title: "Wiki document created",
      description: `Wiki "${wiki.title}" was created`,
      actor_id: creatorId,
    });
  }

  await auditService.log({
    user_id: creatorId,
    action: "wiki.create",
    resource_type: "wiki",
    resource_id: wiki.id,
    new_value: wiki,
  });

  return wiki;
}

export async function getWikis(query: WikiQueryInput) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (query.project_id) {
    where.project_id = query.project_id;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.search) {
    where.OR = [
      { title: { contains: query.search } },
      { content: { contains: query.search } },
    ];
  }

  const [wikis, total] = await Promise.all([
    prisma.wikiDocument.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { updated_at: "desc" },
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
    prisma.wikiDocument.count({ where }),
  ]);

  return {
    wikis,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getWikiById(wikiId: string) {
  const wiki = await prisma.wikiDocument.findUnique({
    where: { id: wikiId },
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      comments: {
        where: { deleted_at: null },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              nickname: true,
            },
          },
        },
        orderBy: { created_at: "asc" },
      },
    },
  });

  if (!wiki) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  return wiki;
}

export async function getWikiBySlug(
  projectId: string | null | undefined,
  slug: string
) {
  const wiki = await prisma.wikiDocument.findFirst({
    where: {
      project_id: projectId ?? null,
      slug,
    },
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          nickname: true,
        },
      },
      comments: {
        where: { deleted_at: null },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              nickname: true,
            },
          },
        },
        orderBy: { created_at: "asc" },
      },
    },
  });

  if (!wiki) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  return wiki;
}

export async function updateWiki(
  wikiId: string,
  data: UpdateWikiInput,
  actorId?: string
) {
  const existing = await prisma.wikiDocument.findUnique({
    where: { id: wikiId },
  });

  if (!existing) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;

  // If approval flow is enabled (document is approved), save to pending_content
  const isApprovedEdit =
    existing.status === "approved" &&
    data.content !== undefined &&
    data.content !== existing.content;

  if (isApprovedEdit) {
    updateData.pending_content = data.content;
    updateData.status = "pending";
  } else if (data.content !== undefined) {
    updateData.content = data.content;
  }

  if (data.status !== undefined && !isApprovedEdit) {
    updateData.status = data.status;
  }

  const wiki = await prisma.wikiDocument.update({
    where: { id: wikiId },
    data: updateData,
  });

  if (existing.project_id) {
    await timelineService.createTimelineEvent({
      project_id: existing.project_id,
      event_type: isApprovedEdit
        ? TimelineEventType.wiki_updated
        : TimelineEventType.wiki_updated,
      title: isApprovedEdit ? "Wiki change pending approval" : "Wiki updated",
      description: `Wiki "${wiki.title}" was ${isApprovedEdit ? "updated (pending approval)" : "updated"}`,
      actor_id: actorId,
    });
  }

  await auditService.log({
    user_id: actorId,
    action: "wiki.update",
    resource_type: "wiki",
    resource_id: wikiId,
    old_value: existing,
    new_value: wiki,
  });

  return wiki;
}

export async function approveWikiChange(
  wikiId: string,
  approverId: string,
  data: ApproveWikiInput
) {
  const wiki = await prisma.wikiDocument.findUnique({
    where: { id: wikiId },
  });

  if (!wiki) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  if (data.approved) {
    // Approve: move pending_content to content
    const updated = await prisma.wikiDocument.update({
      where: { id: wikiId },
      data: {
        status: "approved",
        content: wiki.pending_content || wiki.content,
        pending_content: null,
        approved_by: approverId,
        approved_at: new Date(),
      },
    });

    if (wiki.project_id) {
      await timelineService.createTimelineEvent({
        project_id: wiki.project_id,
        event_type: TimelineEventType.wiki_approved,
        title: "Wiki change approved",
        description: `Wiki "${wiki.title}" changes were approved`,
        actor_id: approverId,
      });
    }

    await auditService.log({
      user_id: approverId,
      action: "wiki.approve",
      resource_type: "wiki",
      resource_id: wikiId,
      new_value: updated,
    });

    return { approved: true, wiki: updated };
  } else {
    // Reject: keep pending_content but change status back to draft
    const updated = await prisma.wikiDocument.update({
      where: { id: wikiId },
      data: {
        status: "draft",
      },
    });

    if (wiki.project_id) {
      await timelineService.createTimelineEvent({
        project_id: wiki.project_id,
        event_type: TimelineEventType.wiki_rejected,
        title: "Wiki change rejected",
        description: `Wiki "${wiki.title}" changes were rejected${data.rejection_reason ? `: ${data.rejection_reason}` : ""}`,
        actor_id: approverId,
      });
    }

    await auditService.log({
      user_id: approverId,
      action: "wiki.reject",
      resource_type: "wiki",
      resource_id: wikiId,
      new_value: updated,
    });

    return { approved: false, reason: data.rejection_reason, wiki: updated };
  }
}

export async function rejectWikiChange(
  wikiId: string,
  approverId: string,
  reason?: string
) {
  const wiki = await prisma.wikiDocument.findUnique({
    where: { id: wikiId },
  });

  if (!wiki) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  const updated = await prisma.wikiDocument.update({
    where: { id: wikiId },
    data: {
      status: "draft",
    },
  });

  if (wiki.project_id) {
    await timelineService.createTimelineEvent({
      project_id: wiki.project_id,
      event_type: TimelineEventType.wiki_rejected,
      title: "Wiki change rejected",
      description: `Wiki "${wiki.title}" changes were rejected${reason ? `: ${reason}` : ""}`,
      actor_id: approverId,
    });
  }

  await auditService.log({
    user_id: approverId,
    action: "wiki.reject",
    resource_type: "wiki",
    resource_id: wikiId,
    new_value: updated,
  });

  return { approved: false, reason, wiki: updated };
}

export async function deleteWiki(wikiId: string, actorId?: string) {
  const existing = await prisma.wikiDocument.findUnique({
    where: { id: wikiId },
  });

  if (!existing) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  if (!actorId) {
    throw new AppError("Authentication required", "FORBIDDEN", 403);
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });

  const isAdmin = actor?.role === "super_admin" || actor?.role === "group_admin";
  const isOwner = existing.created_by === actorId;

  let isProjectSupervisor = false;
  if (existing.project_id && !isAdmin && !isOwner) {
    const membership = await prisma.projectMember.findUnique({
      where: {
        project_id_user_id: {
          project_id: existing.project_id,
          user_id: actorId,
        },
      },
      select: { role: true, is_lead: true },
    });
    isProjectSupervisor = membership?.is_lead === true || membership?.role === "supervisor";
  }

  if (!isAdmin && !isOwner && !isProjectSupervisor) {
    throw new AppError("Not authorized to delete this wiki", "FORBIDDEN", 403);
  }

  await prisma.wikiDocument.delete({
    where: { id: wikiId },
  });

  await auditService.log({
    user_id: actorId,
    action: "wiki.delete",
    resource_type: "wiki",
    resource_id: wikiId,
    old_value: existing,
  });

  return { success: true };
}

// Comments
export async function createComment(
  userId: string,
  data: CreateCommentInput
) {
  if (!data.file_version_id && !data.wiki_id && !data.task_id) {
    throw new AppError(
      "Comment must be associated with a file, wiki document, or task",
      "BAD_REQUEST",
      400
    );
  }

  const comment = await prisma.comment.create({
    data: {
      user_id: userId,
      content: data.content,
      file_version_id: data.file_version_id,
      wiki_id: data.wiki_id,
      task_id: data.task_id,
      line_number: data.line_number,
      parent_id: data.parent_id,
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

  return comment;
}

export async function getComments(wikiId: string) {
  const comments = await prisma.comment.findMany({
    where: {
      wiki_id: wikiId,
      deleted_at: null,
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
      replies: {
        where: { deleted_at: null },
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
    },
    orderBy: { created_at: "asc" },
  });

  return comments;
}

export async function getTaskComments(taskId: string) {
  const comments = await prisma.comment.findMany({
    where: {
      task_id: taskId,
      deleted_at: null,
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
      replies: {
        where: { deleted_at: null },
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
    },
    orderBy: { created_at: "asc" },
  });

  return comments;
}

export async function updateComment(
  commentId: string,
  userId: string,
  content: string
) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new AppError("Comment not found", "NOT_FOUND", 404);
  }

  if (comment.user_id !== userId) {
    throw new AppError("Not authorized to edit this comment", "FORBIDDEN", 403);
  }

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { content },
  });

  return updated;
}

export async function deleteComment(commentId: string, userId: string) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new AppError("Comment not found", "NOT_FOUND", 404);
  }

  if (comment.user_id !== userId) {
    throw new AppError(
      "Not authorized to delete this comment",
      "FORBIDDEN",
      403
    );
  }

  await prisma.comment.update({
    where: { id: commentId },
    data: { deleted_at: new Date() },
  });

  return { success: true };
}
