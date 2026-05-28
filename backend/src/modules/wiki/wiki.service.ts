import { prisma } from "../../config/database";
import { AppError } from "../../utils/response";
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
  const existing = await prisma.wikiDocument.findUnique({
    where: {
      project_id_slug: {
        project_id: data.project_id || null,
        slug: data.slug,
      },
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
      project_id: data.project_id || null,
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
      { title: { contains: query.search, mode: "insensitive" } },
      { content: { contains: query.search, mode: "insensitive" } },
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
      approved_by_user: {
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
  projectId: string | null,
  slug: string
) {
  const wiki = await prisma.wikiDocument.findUnique({
    where: {
      project_id_slug: {
        project_id: projectId,
        slug,
      },
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
  data: UpdateWikiInput
) {
  const existing = await prisma.wikiDocument.findUnique({
    where: { id: wikiId },
  });

  if (!existing) {
    throw new AppError("Wiki document not found", "NOT_FOUND", 404);
  }

  // If document is approved, new edits go to pending_content
  const isApprovedEdit =
    existing.status === "approved" &&
    data.content !== undefined &&
    data.content !== existing.content;

  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.status !== undefined) updateData.status = data.status;

  if (isApprovedEdit) {
    updateData.pending_content = data.content;
    updateData.status = "pending";
  } else if (data.content !== undefined) {
    updateData.content = data.content;
  }

  if (data.pending_content !== undefined && !isApprovedEdit) {
    updateData.pending_content = data.pending_content;
  }

  const wiki = await prisma.wikiDocument.update({
    where: { id: wikiId },
    data: updateData,
  });

  return wiki;
}

export async function approveWiki(
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
    await prisma.wikiDocument.update({
      where: { id: wikiId },
      data: {
        status: "approved",
        content: wiki.pending_content || wiki.content,
        pending_content: null,
        approved_by: approverId,
        approved_at: new Date(),
      },
    });
  } else {
    // Reject: keep pending_content but change status
    await prisma.wikiDocument.update({
      where: { id: wikiId },
      data: {
        status: "draft",
      },
    });
  }

  return { approved: data.approved };
}

export async function deleteWiki(wikiId: string) {
  await prisma.wikiDocument.delete({
    where: { id: wikiId },
  });

  return { success: true };
}

// Comments
export async function createComment(
  userId: string,
  data: CreateCommentInput
) {
  if (!data.file_version_id && !data.wiki_id) {
    throw new AppError(
      "Comment must be associated with a file or wiki document",
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
