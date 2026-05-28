import nodemailer from "nodemailer";
import { env } from "../../../config/env";
import { NotificationType } from "@prisma/client";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    if (env.NODE_ENV === "development") {
      console.warn("[EmailAdapter] SMTP not configured, emails will be logged only");
    }
    return null;
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    pool: true,
    maxConnections: 5,
  });

  return transporter;
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  notificationType?: NotificationType;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function renderEmailTemplate(subject: string, body: string, notificationType?: NotificationType): string {
  const typeLabel = notificationType ? `[${getTypeLabel(notificationType)}] ` : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${typeLabel}${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #3b82f6; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; }
    .footer { margin-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h2 style="margin:0">${typeLabel}${subject}</h2>
  </div>
  <div class="content">
    <p>${escapeHtml(body)}</p>
  </div>
  <div class="footer">
    <p>此邮件由字幕组协作平台自动发送，请勿直接回复。</p>
  </div>
</body>
</html>`;
}

function getTypeLabel(type: NotificationType): string {
  const labels: Record<NotificationType, string> = {
    task_assigned: "任务指派",
    task_completed: "任务完成",
    task_reassigned: "任务转交",
    task_cancelled: "任务取消",
    task_reset: "任务重置",
    review_requested: "审核请求",
    review_approved: "审核通过",
    review_rejected: "审核未通过",
    claim_expired: "认领过期",
    project_update: "项目更新",
    mention: "提及",
    system: "系统",
    join_request: "加入申请",
    join_approved: "申请通过",
    join_rejected: "申请未通过",
    file_uploaded: "文件上传",
    conflict_detected: "冲突检测",
    announcement: "公告",
    task_overdue: "任务超期",
    downstream_reset: "下游重置",
  };
  return labels[type] || "通知";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const t = getTransporter();

  if (!t) {
    console.log(`[EmailAdapter] Would send email to ${payload.to}: ${payload.subject}`);
    return { success: true, messageId: `mock-${Date.now()}` };
  }

  try {
    const from = process.env.SMTP_FROM || "noreply@subtitle-group.local";
    const html = renderEmailTemplate(payload.subject, payload.body, payload.notificationType);

    const info = await t.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      html,
      text: payload.body,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[EmailAdapter] Failed to send email:", errMsg);
    return { success: false, error: errMsg };
  }
}

export async function verifyEmailConnection(): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.verify();
    return true;
  } catch {
    return false;
  }
}
