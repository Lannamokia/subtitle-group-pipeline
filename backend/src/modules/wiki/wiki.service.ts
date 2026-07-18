import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
import { TimelineEventType, UserRole } from "@prisma/client";
import * as timelineService from "../timeline/timeline.service";
import * as auditService from "../audit/audit.service";
import * as notificationService from "../notification/notification.service";
import { assertProjectViewPermission } from "../project/project-access";
import type {
  CreateWikiInput,
  UpdateWikiInput,
  WikiQueryInput,
  ApproveWikiInput,
  CreateCommentInput,
} from "./wiki.schema";

type WikiWithPresentation<T extends { content: string; pending_content: string | null; status: string }> =
  T & {
    display_content: string;
    pending_diff: { from: string; to: string } | null;
    approval_required: boolean;
  };

async function isWikiApprovalRequired(projectId: string | null | undefined): Promise<boolean> {
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { wiki_approval_required: true },
    });

    if (project?.wiki_approval_required !== null && project?.wiki_approval_required !== undefined) {
      return project.wiki_approval_required;
    }
  }

  const settings = await prisma.dataRetentionSettings.findFirst({
    orderBy: { updated_at: "desc" },
    select: { wiki_approval_required: true },
  });

  return settings?.wiki_approval_required ?? false;
}

async function assertWikiWritePermission(
  projectId: string | null | undefined,
  actorId: string,
  ownerId?: string
) {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  if (!actor) throw new AppError("Actor not found", "NOT_FOUND", 404);

  if (projectId) {
    await assertProjectViewPermission(projectId, actorId, actor.role, {
      allowOpenClaimCandidate: false,
    });
    return;
  }

  if (ownerId !== undefined && ownerId !== actorId && !["super_admin", "group_admin"].includes(actor.role)) {
    throw new AppError("Not authorized to update this wiki", "FORBIDDEN", 403);
  }
}

async function assertWikiApprovalPermission(
  projectId: string | null | undefined,
  actorId: string
): Promise<void> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  if (!actor) throw new AppError("Actor not found", "NOT_FOUND", 404);
  if (["super_admin", "group_admin", "supervisor"].includes(actor.role)) return;

  if (!projectId) {
    throw new AppError("Only supervisors can review Wiki changes", "FORBIDDEN", 403);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      owner_id: true,
      members: {
        where: {
          user_id: actorId,
          left_at: null,
          OR: [{ role: "supervisor" }, { is_lead: true }],
        },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!project) throw new AppError("Project not found", "NOT_FOUND", 404);
  if (project.owner_id !== actorId && project.members.length === 0) {
    throw new AppError("Only project supervisors can review Wiki changes", "FORBIDDEN", 403);
  }
}

async function withWikiPresentation<T extends { project_id: string | null; content: string; pending_content: string | null; status: string }>(
  wiki: T
): Promise<WikiWithPresentation<T>> {
  const approvalRequired = await isWikiApprovalRequired(wiki.project_id);
  return {
    ...wiki,
    display_content: wiki.status === "approved" ? wiki.content : "",
    pending_diff: wiki.pending_content
      ? { from: wiki.content, to: wiki.pending_content }
      : null,
    approval_required: approvalRequired,
  };
}

export async function createWiki(
  creatorId: string,
  data: CreateWikiInput
) {
  if (data.project_id) {
    await assertWikiWritePermission(data.project_id, creatorId);
  }

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

  return withWikiPresentation(wiki);
}

export async function getWikis(query: WikiQueryInput, userId: string, userRole: UserRole) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (query.project_id) {
    await assertProjectViewPermission(query.project_id, userId, userRole);
  } else if (!["super_admin", "group_admin", "supervisor"].includes(userRole)) {
    where.project_id = null;
  }

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
    wikis: await Promise.all(wikis.map((wiki) => withWikiPresentation(wiki))),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getWikiById(wikiId: string, userId: string, userRole: UserRole) {
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

  if (wiki.project_id) {
    await assertProjectViewPermission(wiki.project_id, userId, userRole);
  }

  return withWikiPresentation(wiki);
}

export async function getWikiBySlug(
  projectId: string | null | undefined,
  slug: string,
  userId: string,
  userRole: UserRole
) {
  if (projectId) {
    await assertProjectViewPermission(projectId, userId, userRole);
  }
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

  return withWikiPresentation(wiki);
}

export async function getWikiByProjectId(projectId: string, userId: string, userRole: UserRole) {
  const projectExists = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!projectExists) return null;

  await assertProjectViewPermission(projectId, userId, userRole);
  const wiki = await prisma.wikiDocument.findFirst({
    where: {
      project_id: projectId,
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

  return wiki ? withWikiPresentation(wiki) : null;
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

  if (!actorId) throw new AppError("Authentication required", "UNAUTHORIZED", 401);
  await assertWikiWritePermission(existing.project_id, actorId, existing.created_by);

  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;

  const approvalRequired = await isWikiApprovalRequired(existing.project_id);

  // If approval flow is enabled, edits to approved content become pending patches.
  const isApprovedEdit =
    approvalRequired &&
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

  return withWikiPresentation(wiki);
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

  await assertWikiApprovalPermission(wiki.project_id, approverId);

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

    return { approved: true, wiki: await withWikiPresentation(updated) };
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

    return { approved: false, reason: data.rejection_reason, wiki: await withWikiPresentation(updated) };
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

  await assertWikiApprovalPermission(wiki.project_id, approverId);

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

  return { approved: false, reason, wiki: await withWikiPresentation(updated) };
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
  userRole: UserRole,
  data: CreateCommentInput
) {
  if (!data.file_version_id && !data.wiki_id && !data.task_id) {
    throw new AppError(
      "Comment must be associated with a file, wiki document, or task",
      "BAD_REQUEST",
      400
    );
  }

  const [fileVersion, wiki, task, parent] = await Promise.all([
    data.file_version_id
      ? prisma.fileVersion.findUnique({
          where: { id: data.file_version_id },
          select: { file: { select: { project_id: true } } },
        })
      : null,
    data.wiki_id
      ? prisma.wikiDocument.findUnique({
          where: { id: data.wiki_id },
          select: { project_id: true },
        })
      : null,
    data.task_id
      ? prisma.task.findUnique({
          where: { id: data.task_id },
          select: { project_id: true },
        })
      : null,
    data.parent_id
      ? prisma.comment.findUnique({
          where: { id: data.parent_id },
          select: {
            file_version: { select: { file: { select: { project_id: true } } } },
            wiki: { select: { project_id: true } },
            task: { select: { project_id: true } },
          },
        })
      : null,
  ]);

  if (data.file_version_id && !fileVersion) {
    throw new AppError("File version not found", "NOT_FOUND", 404);
  }
  if (data.wiki_id && !wiki) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }
  if (data.task_id && !task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }
  if (data.parent_id && !parent) {
    throw new AppError("Parent comment not found", "NOT_FOUND", 404);
  }

  const projectIds = new Set<string>();
  if (fileVersion?.file.project_id) projectIds.add(fileVersion.file.project_id);
  if (wiki?.project_id) projectIds.add(wiki.project_id);
  if (task?.project_id) projectIds.add(task.project_id);
  if (parent?.file_version?.file.project_id) projectIds.add(parent.file_version.file.project_id);
  if (parent?.wiki?.project_id) projectIds.add(parent.wiki.project_id);
  if (parent?.task?.project_id) projectIds.add(parent.task.project_id);

  if (projectIds.size > 1) {
    throw new AppError("Comment references must belong to the same project", "BAD_REQUEST", 400);
  }
  const projectId = [...projectIds][0];
  if (projectId) {
    await assertProjectViewPermission(projectId, userId, userRole, {
      allowOpenClaimCandidate: false,
    });
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
      file_version: {
        include: {
          file: {
            select: {
              id: true,
              name: true,
              original_name: true,
              file_type: true,
              project_id: true,
            },
          },
        },
      },
    },
  });

  // Trigger @ mention notifications asynchronously (don't block response)
  processMentions(userId, data.content, data.task_id, data.wiki_id).catch(() => {
    // Silently fail - mention notifications are best-effort
  });

  return comment;
}

async function processMentions(
  actorId: string,
  content: string,
  taskId?: string | null,
  wikiId?: string | null
) {
  // Extract @username mentions from content
  const mentionRegex = /@([a-zA-Z0-9_\-]+)/g;
  const usernames: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    usernames.push(match[1]);
  }

  if (usernames.length === 0) return;

  const mentionedUsers = await prisma.user.findMany({
    where: {
      username: { in: usernames },
      id: { not: actorId },
    },
    select: { id: true, username: true },
  });

  let projectId: string | undefined;

  if (taskId) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { project_id: true, title: true },
    });
    projectId = task?.project_id;
  } else if (wikiId) {
    const wiki = await prisma.wikiDocument.findUnique({
      where: { id: wikiId },
      select: { project_id: true, title: true },
    });
    projectId = wiki?.project_id ?? undefined;
  }

  for (const user of mentionedUsers) {
    await notificationService.createNotification(user.id, "mention", {
      projectId,
      taskId: taskId ?? undefined,
      actorId,
    });
  }
}

export async function getComments(wikiId: string, userId: string, userRole: UserRole) {
  const wiki = await prisma.wikiDocument.findUnique({
    where: { id: wikiId },
    select: { project_id: true },
  });
  if (!wiki) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  if (wiki.project_id) {
    await assertProjectViewPermission(wiki.project_id, userId, userRole);
  }

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
      file_version: {
        include: {
          file: {
            select: {
              id: true,
              name: true,
              original_name: true,
              file_type: true,
              project_id: true,
            },
          },
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

export async function getTaskComments(taskId: string, userId: string, userRole: UserRole) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { project_id: true },
  });
  if (!task) {
    throw new AppError("Task not found", "NOT_FOUND", 404);
  }
  await assertProjectViewPermission(task.project_id, userId, userRole, {
    allowOpenClaimCandidate: false,
  });

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
      file_version: {
        include: {
          file: {
            select: {
              id: true,
              name: true,
              original_name: true,
              file_type: true,
              project_id: true,
            },
          },
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
