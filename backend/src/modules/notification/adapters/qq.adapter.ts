import { env } from "../../../config/env";

const NONEBOT_HTTP_API = process.env.NONEBOT_HTTP_API || "http://localhost:8095";
const MAX_RETRIES = 3;

export interface QQMessagePayload {
  groupId: string;
  content: string;
  atUsers?: string[]; // QQ numbers to @mention
}

export interface QQPrivatePayload {
  userId: string;
  content: string;
}

export interface QQResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export function getQQBridgeEndpoint(): string {
  return NONEBOT_HTTP_API;
}

function formatAtMention(qqNumber: string): string {
  return `[CQ:at,qq=${qqNumber}]`;
}

export async function checkQQBridgeHealth(): Promise<QQResult> {
  if ((env.NODE_ENV === "development" || env.NODE_ENV === "test") && !process.env.NONEBOT_HTTP_API) {
    return { success: true, messageId: "mock-qq-bridge" };
  }

  try {
    const response = await fetch(`${NONEBOT_HTTP_API}/get_status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.QQ_BRIDGE_TOKEN ? { Authorization: `Bearer ${env.QQ_BRIDGE_TOKEN}` } : {}),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function escapeCQCode(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/,/g, "&#44;");
}

export function buildGroupMessageContent(payload: QQMessagePayload): string {
  let message = escapeCQCode(payload.content);

  if (payload.atUsers && payload.atUsers.length > 0) {
    const atPrefix = payload.atUsers.map(formatAtMention).join(" ");
    message = `${atPrefix}\n${message}`;
  }

  return message;
}

async function sendNoneBotRequest(
  endpoint: string,
  payload: Record<string, unknown>,
  retryCount = 0
): Promise<QQResult> {
  try {
    const response = await fetch(`${NONEBOT_HTTP_API}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.QQ_BRIDGE_TOKEN ? { Authorization: `Bearer ${env.QQ_BRIDGE_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    return {
      success: true,
      messageId: (data?.message_id as string) || `qq-${Date.now()}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    if (retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendNoneBotRequest(endpoint, payload, retryCount + 1);
    }

    console.error(`[QQAdapter] Failed after ${MAX_RETRIES} retries:`, errMsg);
    return { success: false, error: errMsg };
  }
}

export async function sendGroupMessage(payload: QQMessagePayload): Promise<QQResult> {
  if ((env.NODE_ENV === "development" || env.NODE_ENV === "test") && !process.env.NONEBOT_HTTP_API) {
    console.log(
      `[QQAdapter] Would send group message to ${payload.groupId}: ${payload.content}` +
        (payload.atUsers?.length ? ` (at: ${payload.atUsers.join(", ")})` : "")
    );
    return { success: true, messageId: `mock-qq-${Date.now()}` };
  }

  return sendNoneBotRequest("/send_group_msg", {
    group_id: payload.groupId,
    message: buildGroupMessageContent(payload),
    auto_escape: false,
  });
}

export async function sendAtMention(
  groupId: string,
  userQQ: string,
  message: string
): Promise<QQResult> {
  return sendGroupMessage({
    groupId,
    content: message,
    atUsers: [userQQ],
  });
}

export async function sendPrivateMessage(payload: QQPrivatePayload): Promise<QQResult> {
  if ((env.NODE_ENV === "development" || env.NODE_ENV === "test") && !process.env.NONEBOT_HTTP_API) {
    console.log(`[QQAdapter] Would send private message to ${payload.userId}: ${payload.content}`);
    return { success: true, messageId: `mock-qq-private-${Date.now()}` };
  }

  return sendNoneBotRequest("/send_private_msg", {
    user_id: payload.userId,
    message: escapeCQCode(payload.content),
    auto_escape: false,
  });
}

export function formatTaskNotification(
  taskName: string,
  projectName: string,
  action: string
): string {
  return `【${projectName}】${action}：${taskName}`;
}

export function formatMentionNotification(
  actorName: string,
  taskName: string,
  content: string
): string {
  return `${actorName} 在「${taskName}」中提到了你：\n${content}`;
}

export function formatOverdueNotification(
  taskName: string,
  projectName: string,
  daysOverdue: number
): string {
  return `【${projectName}】任务「${taskName}」已超期 ${daysOverdue} 天，请尽快处理！`;
}
