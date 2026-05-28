import { prisma } from "../../config/database";

export interface AuditLogEntry {
  user_id?: string;
  project_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  old_value?: unknown;
  new_value?: unknown;
  ip_address?: string;
  user_agent?: string;
}

export async function log(entry: AuditLogEntry) {
  await prisma.auditLog.create({
    data: {
      user_id: entry.user_id,
      project_id: entry.project_id,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      old_value: entry.old_value ? JSON.stringify(entry.old_value) : null,
      new_value: entry.new_value ? JSON.stringify(entry.new_value) : null,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
    },
  });
}

export async function getAuditLogs(options: {
  user_id?: string;
  project_id?: string;
  action?: string;
  resource_type?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (options.user_id) {
    where.user_id = options.user_id;
  }
  if (options.project_id) {
    where.project_id = options.project_id;
  }
  if (options.action) {
    where.action = options.action;
  }
  if (options.resource_type) {
    where.resource_type = options.resource_type;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { created_at: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
          },
        },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function cleanupOldLogs(retentionDays: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const result = await prisma.auditLog.deleteMany({
    where: {
      created_at: {
        lt: cutoff,
      },
    },
  });

  return { deleted: result.count };
}
