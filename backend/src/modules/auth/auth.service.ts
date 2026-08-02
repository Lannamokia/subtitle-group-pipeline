import crypto from "crypto";
import { prisma } from "../../config/database";
import { hashPassword, comparePassword } from "../../utils/password";
import { signToken, signRefreshToken, verifyRefreshToken, verifyToken, type JWTPayload } from "../../utils/jwt";
import { AppError } from "../../utils/response";
import { sendEmail } from "../notification/adapters/email.adapter";
import { sendPrivateMessage } from "../notification/adapters/qq.adapter";
import { deleteAvatarByUrl } from "../storage/storage.service";
import { recordCredentialFailure, requireVerification } from "../captcha/captcha.service";
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  UpdateProfileInput,
  VerifyQQInput,
  RefreshTokenInput,
  UpdateRegistrationPolicyInput,
  CreateRoleTagInput,
  UpdateRoleTagInput,
  CreateTagApplicationInput,
  ReviewTagApplicationInput,
  ResetTagStatusInput,
  GrantTagStatusInput,
  UpdateUserRoleInput,
  UpdateUserStatusInput,
  CreateMemberInput,
  ResetUserPasswordInput,
  ConfirmPasswordResetInput,
  UpdateMemberProfileInput,
  RequestQQRebindInput,
} from "./auth.schema";

const NON_EXPIRING_VERIFICATION_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");
const PASSWORD_RESET_PREFIX = "PWD:";
const PASSWORD_RESET_EXPIRES_MS = 15 * 60 * 1000;
const QQ_REBIND_OLD_PREFIX = "QQB_OLD:";
const QQ_REBIND_NEW_PREFIX = "QQB_NEW:";
const QQ_REBIND_EXPIRES_MS = 15 * 60 * 1000;

function generateVerificationCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(crypto.randomInt(chars.length));
  }
  return result;
}

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function toPasswordResetChallengeCode(code: string): string {
  return `${PASSWORD_RESET_PREFIX}${code}`;
}

function fromPasswordResetChallengeCode(challengeCode: string): string {
  return challengeCode.startsWith(PASSWORD_RESET_PREFIX)
    ? challengeCode.slice(PASSWORD_RESET_PREFIX.length)
    : challengeCode;
}

function toQQRebindOldChallengeCode(code: string): string {
  return `${QQ_REBIND_OLD_PREFIX}${code}`;
}

function toQQRebindNewChallengeCode(code: string): string {
  return `${QQ_REBIND_NEW_PREFIX}${code}`;
}

function getQQRebindFlowPrefix(code: string): string {
  return code.slice(0, 8);
}

function getRegisterQQNumber(data: RegisterInput): string | null | undefined {
  return data.qq_number ?? data.qq;
}

function getMemberQQNumber(data: CreateMemberInput): string | null | undefined {
  return data.qq_number ?? data.qq;
}

function getUpdateMemberQQNumber(data: UpdateMemberProfileInput): string | null | undefined {
  return data.qq_number ?? data.qq;
}

function buildPendingVerificationResponse(
  user: unknown,
  qqGroup: string | null | undefined,
  code: string
) {
  const verifyCommand = `/verify ${code}`;

  const response: Record<string, unknown> = {
    status: "pending_verification" as const,
    requiresVerification: true,
    qqGroup: qqGroup || null,
    verifyCommand,
    copyReady: code,
    verification: {
      qqGroup: qqGroup || "",
      command: verifyCommand,
    },
  };

  if (user) {
    response.user = user;
  }

  return response;
}

function serializeRegistrationPolicy(policy: {
  mode: string;
  require_qq: boolean;
  qq_group_number: string | null;
  welcome_message: string | null;
  auto_approve: boolean;
  updated_at: Date;
}) {
  return {
    mode: policy.mode,
    require_qq: policy.require_qq,
    qq_group_number: policy.qq_group_number,
    qqGroup: policy.qq_group_number || "",
    welcome_message: policy.welcome_message,
    auto_approve: policy.auto_approve,
    codeLength: 8,
    roleTagEnabled: true,
    updated_at: policy.updated_at,
  };
}

async function getLatestRegistrationPolicy() {
  const policy = await prisma.registrationPolicy.findFirst({
    orderBy: { created_at: "desc" },
  });

  if (policy) {
    return policy;
  }

  return prisma.registrationPolicy.create({
    data: {
      mode: "open",
      require_qq: false,
      auto_approve: true,
    },
  });
}

async function createVerificationChallenge(userId: string, qqNumber?: string | null) {
  const code = generateVerificationCode();

  await prisma.verificationChallenge.create({
    data: {
      code,
      qq_number: qqNumber || "",
      expires_at: NON_EXPIRING_VERIFICATION_EXPIRES_AT,
      used_by: userId,
    },
  });

  return code;
}

async function validateRegistrationTagIds(tagIds: RegisterInput["tags"]) {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }

  const uniqueTagIds = [...new Set(tagIds)];
  const existingTags = await prisma.roleTag.findMany({
    where: { id: { in: uniqueTagIds } },
    select: { id: true },
  });

  if (existingTags.length !== uniqueTagIds.length) {
    throw new AppError("One or more role tags do not exist", "VALIDATION_ERROR", 400);
  }

  return uniqueTagIds;
}

async function createInitialTagApplications(userId: string, tagIds: string[]) {
  if (tagIds.length === 0) {
    return;
  }

  for (const tagId of tagIds) {
    await prisma.tagApplication.upsert({
      where: { user_id_tag_id: { user_id: userId, tag_id: tagId } },
      update: {},
      create: {
        user_id: userId,
        tag_id: tagId,
        reason: "Selected during registration",
      },
    });
  }
}

async function assertUniqueAccountIdentifiers(data: {
  username: string;
  email?: string | null;
  qqNumber?: string | null;
  excludeUserId?: string;
}) {
  const [existingUsername, existingEmail, existingQQ] = await Promise.all([
    prisma.user.findUnique({
      where: { username: data.username },
      select: { id: true },
    }),
    data.email
      ? prisma.user.findUnique({
          where: { email: data.email },
          select: { id: true },
        })
      : Promise.resolve(null),
    data.qqNumber
      ? prisma.user.findFirst({
          where: { qq_number: data.qqNumber },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (existingUsername && existingUsername.id !== data.excludeUserId) {
    throw new AppError("Username already taken", "DUPLICATE_ERROR", 409);
  }

  if (existingEmail && existingEmail.id !== data.excludeUserId) {
    throw new AppError("Email already registered", "DUPLICATE_ERROR", 409);
  }

  if (existingQQ && existingQQ.id !== data.excludeUserId) {
    throw new AppError("QQ number already registered", "DUPLICATE_ERROR", 409);
  }
}

export async function registerUser(data: RegisterInput) {
  // Get current registration policy
  const policy = await getLatestRegistrationPolicy();

  const mode = policy.mode;

  if (mode === "disabled") {
    throw new AppError(
      "Registration is currently disabled",
      "REGISTRATION_DISABLED",
      403
    );
  }

  const passwordHash = await hashPassword(data.password);
  const qqNumber = getRegisterQQNumber(data);
  await assertUniqueAccountIdentifiers({
    username: data.username,
    email: data.email,
    qqNumber,
  });
  const tagIds = await validateRegistrationTagIds(data.tags);

  if (mode === "qq_verification") {
    // Create user with pending verification status
    const user = await prisma.user.create({
      data: {
        username: data.username,
        password_hash: passwordHash,
        nickname: data.nickname || data.username,
        email: data.email,
        qq_number: qqNumber,
        role: "member",
        status: "pending_verification",
      },
      select: {
        id: true,
        username: true,
        nickname: true,
        email: true,
        role: true,
        status: true,
        qq_number: true,
        created_at: true,
      },
    });

    await createInitialTagApplications(user.id, tagIds);

    const code = await createVerificationChallenge(user.id, qqNumber);

    return buildPendingVerificationResponse(user, policy.qq_group_number, code);
  }

  // open mode: create active user
  const user = await prisma.user.create({
    data: {
      username: data.username,
      password_hash: passwordHash,
      nickname: data.nickname || data.username,
      email: data.email,
      qq_number: qqNumber,
      role: "member",
      status: "active",
    },
    select: {
      id: true,
      username: true,
      nickname: true,
      email: true,
      role: true,
      status: true,
      created_at: true,
    },
  });

  await createInitialTagApplications(user.id, tagIds);

  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  const refreshToken = signRefreshToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  return { status: "active" as const, user, token, refreshToken };
}

export async function loginUser(data: LoginInput) {
  const captchaAttemptId = await requireVerification(data.username, data.verificationToken);
  const user = await prisma.user.findUnique({
    where: { username: data.username },
  });

  if (!user) {
    await recordCredentialFailure(captchaAttemptId);
    throw new AppError("Invalid credentials", "UNAUTHORIZED", 401);
  }

  const valid = await comparePassword(data.password, user.password_hash);
  if (!valid) {
    await recordCredentialFailure(captchaAttemptId);
    throw new AppError("Invalid credentials", "UNAUTHORIZED", 401);
  }

  // Handle pending verification - return special response, NOT a session
  if (user.status === "pending_verification") {
    const policy = await getLatestRegistrationPolicy();

    const challenge = await prisma.verificationChallenge.findFirst({
      where: {
        used_by: user.id,
        used_at: null,
      },
      orderBy: { created_at: "desc" },
    });

    let code = challenge?.code;

    // If no active challenge, create a new one
    if (!code) {
      code = await createVerificationChallenge(user.id, user.qq_number);
    }

    return buildPendingVerificationResponse(null, policy.qq_group_number, code);
  }

  // Handle disabled account
  if (user.status === "disabled") {
    throw new AppError("Account has been disabled", "FORBIDDEN", 403);
  }

  // Active user - proceed with normal login
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login_at: new Date() },
  });

  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  const refreshToken = signRefreshToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  // 登录时一并返回已通过的岗位标签，前端才能在不额外请求 /auth/me 的情况下
  // 正确判断认领资格（例如翻译分段的认领入口）。
  const approvedTags = await prisma.tagApplication.findMany({
    where: { user_id: user.id, approved: true },
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          role_type: true,
          description: true,
          color: true,
          created_at: true,
        },
      },
    },
    orderBy: { created_at: "asc" },
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      role: user.role,
      status: user.status,
      avatar_url: user.avatar_url,
      qq_number: user.qq_number,
      created_at: user.created_at,
      roleTags: approvedTags.map((application) => application.tag),
    },
    token,
    refreshToken,
  };
}

export async function verifyByQQ(data: VerifyQQInput) {
  const challenge = await prisma.verificationChallenge.findUnique({
    where: { code: data.code },
  });

  if (!challenge) {
    throw new AppError("Invalid verification code", "NOT_FOUND", 404);
  }

  if (challenge.used_at) {
    throw new AppError("Verification code already used", "CONFLICT", 409);
  }

  // Validate QQ group matches configured group (if configured)
  const policy = await getLatestRegistrationPolicy();

  if (policy.qq_group_number && data.qq_group !== policy.qq_group_number) {
    throw new AppError(
      "QQ group number does not match configured group",
      "FORBIDDEN",
      403
    );
  }

  // Find the user associated with this challenge
  const userId = challenge.used_by;
  if (!userId) {
    throw new AppError("No user associated with this code", "NOT_FOUND", 404);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  // Activate the user
  const activatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      status: "active",
      qq_number: data.qq_number || user.qq_number,
    },
    select: {
      id: true,
      username: true,
      nickname: true,
      email: true,
      role: true,
      status: true,
      avatar_url: true,
    },
  });

  // Mark challenge as used (clear verification association)
  await prisma.verificationChallenge.update({
    where: { id: challenge.id },
    data: {
      used_at: new Date(),
      used_by: null,
    },
  });

  // Generate tokens for the newly activated user
  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  const refreshToken = signRefreshToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  return {
    success: true,
    status: "active" as const,
    user: activatedUser,
    token,
    refreshToken,
  };
}

export async function getRegistrationPolicy() {
  const policy = await getLatestRegistrationPolicy();
  return serializeRegistrationPolicy(policy);
}

export async function updateRegistrationPolicy(
  data: UpdateRegistrationPolicyInput,
  actorId?: string
) {
  const qqGroup = data.qq_group_number ?? data.qqGroup ?? null;

  const policy = await prisma.registrationPolicy.create({
    data: {
      mode: data.mode,
      require_qq: data.require_qq ?? data.mode === "qq_verification",
      qq_group_number: qqGroup || null,
      welcome_message: data.welcome_message ?? null,
      auto_approve: data.auto_approve ?? data.mode !== "qq_verification",
      updated_by: actorId,
    },
  });

  return serializeRegistrationPolicy(policy);
}

export async function refreshToken(data: RefreshTokenInput) {
  try {
    const payload = verifyRefreshToken(data.refreshToken);
    if (payload.sessionType === "recovery") {
      throw new AppError("Recovery sessions cannot be refreshed", "RECOVERY_SESSION_RESTRICTED", 403);
    }
    await assertTokenNotRevoked(payload);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new AppError("User not found", "UNAUTHORIZED", 401);
    }

    if (user.status === "disabled" || user.status === "pending_verification") {
      throw new AppError("Account is not active", "FORBIDDEN", 403);
    }

    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const newRefreshToken = signRefreshToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    await revokeTokenPayload(payload);
    return { token, refreshToken: newRefreshToken };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof Error && error.name === "TokenExpiredError") {
      throw new AppError("Refresh token expired", "TOKEN_EXPIRED", 401);
    }
    if (error instanceof Error && error.name === "JsonWebTokenError") {
      throw new AppError("Invalid refresh token", "INVALID_TOKEN", 401);
    }
    throw new AppError("Invalid refresh token", "UNAUTHORIZED", 401);
  }
}

function tokenExpiresAt(payload: JWTPayload): Date {
  if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
    return new Date(payload.exp * 1000);
  }

  return new Date();
}

async function assertTokenNotRevoked(payload: JWTPayload): Promise<void> {
  if (!payload.jti) {
    throw new AppError("Invalid token", "UNAUTHORIZED", 401);
  }

  const revoked = await prisma.revokedToken.findUnique({
    where: { jti: payload.jti },
    select: { jti: true },
  });

  if (revoked) {
    throw new AppError("Invalid token", "UNAUTHORIZED", 401);
  }
}

async function revokeTokenPayload(payload: JWTPayload): Promise<void> {
  if (!payload.jti) {
    throw new AppError("Invalid token", "UNAUTHORIZED", 401);
  }

  await prisma.revokedToken.upsert({
    where: { jti: payload.jti },
    update: {},
    create: {
      jti: payload.jti,
      user_id: payload.userId,
      expires_at: tokenExpiresAt(payload),
    },
  });
}

export async function cleanupExpiredRevokedTokens(now: Date = new Date()) {
  const result = await prisma.revokedToken.deleteMany({
    where: {
      expires_at: { lt: now },
    },
  });

  return { deletedCount: result.count };
}

export async function logoutUser(_userId: string, token?: string) {
  if (token) {
    const payload = verifyToken(token);
    await revokeTokenPayload(payload);
  }

  return { success: true };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      nickname: true,
      email: true,
      role: true,
      status: true,
      avatar_url: true,
      bio: true,
      qq_number: true,
      last_login_at: true,
      created_at: true,
      updated_at: true,
      tag_applications: {
        where: { approved: true },
        select: {
          tag: {
            select: {
              id: true,
              name: true,
              role_type: true,
              description: true,
              color: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  // Flatten role tags for the response
  const roleTags = user.tag_applications.map((ta) => ta.tag);

  return {
    ...user,
    roleTags,
  };
}

export async function updateProfile(userId: string, data: UpdateProfileInput) {
  const updateData: Record<string, unknown> = {};
  const previousUser = data.avatar_url !== undefined
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { avatar_url: true },
      })
    : null;

  if (data.nickname !== undefined) {
    updateData.nickname = data.nickname;
  }
  if (data.email !== undefined) {
    updateData.email = data.email;
  }
  if (data.bio !== undefined) {
    updateData.bio = data.bio;
  }
  if (data.avatar_url !== undefined) {
    updateData.avatar_url = data.avatar_url;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      username: true,
      nickname: true,
      email: true,
      role: true,
      status: true,
      bio: true,
      avatar_url: true,
      qq_number: true,
      created_at: true,
      updated_at: true,
    },
  });

  if (
    data.avatar_url !== undefined &&
    previousUser?.avatar_url &&
    previousUser.avatar_url !== data.avatar_url
  ) {
    try {
      await deleteAvatarByUrl(previousUser.avatar_url);
    } catch (error) {
      console.warn(`[Auth] Failed to delete old avatar for user ${userId}:`, error);
    }
  }

  return user;
}

export async function changePassword(
  userId: string,
  data: ChangePasswordInput
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  const valid = await comparePassword(data.currentPassword, user.password_hash);
  if (!valid) {
    throw new AppError("Current password is incorrect", "UNAUTHORIZED", 401);
  }

  const newHash = await hashPassword(data.newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { password_hash: newHash },
  });

  return { success: true };
}

export async function requestPasswordReset(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
  });
  const message =
    "如果该账号存在，系统已发送密码重置验证码。请使用邮件验证码或在绑定 QQ 上发送 /resetpass 指令完成验证。";

  if (!user) {
    // Return success even if user not found to prevent username enumeration
    return {
      success: true,
      message,
    };
  }

  const resetCode = generateVerificationCode();
  const pollToken = generateSecureToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_MS);

  await prisma.verificationChallenge.updateMany({
    where: {
      used_by: user.id,
      code: { startsWith: PASSWORD_RESET_PREFIX },
      used_at: null,
    },
    data: { used_at: new Date() },
  });

  await prisma.verificationChallenge.create({
    data: {
      code: toPasswordResetChallengeCode(resetCode),
      qq_number: user.qq_number || "",
      expires_at: expiresAt,
      used_by: user.id,
      poll_token: pollToken,
    },
  });

  const resetCommand = `/resetpass ${resetCode}`;

  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: "密码重置验证码",
      body: `你的密码重置验证码是：${resetCode}\n\n验证码 15 分钟内有效。也可以使用绑定 QQ 向机器人发送：${resetCommand}`,
      notificationType: "system",
    }).catch(() => undefined);
  }

  if (user.qq_number) {
    await sendPrivateMessage({
      userId: user.qq_number,
      content: `密码重置验证码：${resetCode}\n请在登录页输入该验证码和新密码，或向机器人发送：${resetCommand}`,
    }).catch(() => undefined);
  }

  return {
    success: true,
    message,
    expiresInSeconds: PASSWORD_RESET_EXPIRES_MS / 1000,
    resetCommand: "/resetpass 验证码",
    emailSent: Boolean(user.email),
    qqSent: Boolean(user.qq_number),
    pollToken,
  };
}

export async function confirmPasswordReset(data: ConfirmPasswordResetInput) {
  // resetToken path: QQ-verified password reset flow
  if (data.resetToken) {
    const RESET_TOKEN_EXPIRES_MS = 10 * 60 * 1000;
    const now = new Date();

    const challenge = await prisma.verificationChallenge.findUnique({
      where: { reset_token: data.resetToken },
    });

    if (
      !challenge ||
      !challenge.qq_verified_at ||
      challenge.used_at ||
      challenge.expires_at < now ||
      now.getTime() - challenge.qq_verified_at.getTime() > RESET_TOKEN_EXPIRES_MS
    ) {
      throw new AppError("Invalid or expired reset token", "INVALID_RESET_CODE", 400);
    }

    const user = challenge.used_by
      ? await prisma.user.findUnique({ where: { id: challenge.used_by } })
      : null;

    if (!user) {
      throw new AppError("Invalid or expired reset token", "INVALID_RESET_CODE", 400);
    }

    const passwordHash = await hashPassword(data.password);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password_hash: passwordHash },
      }),
      prisma.verificationChallenge.update({
        where: { id: challenge.id },
        data: { used_at: new Date() },
      }),
    ]);

    return { success: true };
  }

  // Legacy username + code path
  const user = await prisma.user.findUnique({
    where: { username: data.username },
  });

  if (!user) {
    throw new AppError("Invalid or expired reset code", "INVALID_RESET_CODE", 400);
  }

  const resetCode = toPasswordResetChallengeCode(data.code!.trim());
  const challenge = await prisma.verificationChallenge.findUnique({
    where: { code: resetCode },
  });

  if (
    !challenge ||
    challenge.used_by !== user.id ||
    challenge.used_at ||
    challenge.expires_at < new Date()
  ) {
    throw new AppError("Invalid or expired reset code", "INVALID_RESET_CODE", 400);
  }

  const passwordHash = await hashPassword(data.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { password_hash: passwordHash },
    }),
    prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: { used_at: new Date() },
    }),
  ]);

  return { success: true };
}

export async function getPasswordResetStatus(pollToken: string) {
  const RESET_TOKEN_EXPIRES_MS = 10 * 60 * 1000;
  const challenge = await prisma.verificationChallenge.findUnique({
    where: { poll_token: pollToken },
  });

  const now = new Date();
  if (
    !challenge ||
    challenge.used_at ||
    challenge.expires_at < now ||
    (challenge.qq_verified_at &&
      now.getTime() - challenge.qq_verified_at.getTime() > RESET_TOKEN_EXPIRES_MS)
  ) {
    // Never reveal whether the token exists, was consumed, or expired.
    return { status: "pending" as const };
  }

  if (challenge.qq_verified_at) {
    return {
      status: "verified" as const,
      resetToken: challenge.reset_token!,
    };
  }

  return { status: "pending" as const };
}

export async function verifyPasswordResetByQQ(data: VerifyQQInput) {
  const resetCode = toPasswordResetChallengeCode(data.code.trim());
  const challenge = await prisma.verificationChallenge.findUnique({
    where: { code: resetCode },
  });

  if (!challenge) {
    throw new AppError("Invalid reset code", "NOT_FOUND", 404);
  }

  if (challenge.used_at) {
    throw new AppError("Reset code already used", "CONFLICT", 409);
  }

  if (challenge.expires_at < new Date()) {
    throw new AppError("Reset code expired", "INVALID_RESET_CODE", 400);
  }

  const userId = challenge.used_by;
  if (!userId) {
    throw new AppError("No user associated with this code", "NOT_FOUND", 404);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, qq_number: true },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  if (user.qq_number && data.qq_number && user.qq_number !== data.qq_number) {
    throw new AppError("QQ number does not match this account", "FORBIDDEN", 403);
  }

  // Idempotent: if already QQ-verified, keep the existing reset token.
  // Otherwise stamp the verification time and issue a fresh reset token.
  if (!challenge.qq_verified_at || !challenge.reset_token) {
    const resetToken = generateSecureToken();
    await prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: {
        qq_verified_at: new Date(),
        reset_token: resetToken,
      },
    });
  }

  return {
    success: true,
    username: user.username,
    code: fromPasswordResetChallengeCode(challenge.code),
    expires_at: challenge.expires_at,
    resetTokenIssued: true,
  };
}

export async function requestQQRebind(userId: string, data: RequestQQRebindInput) {
  const newQQNumber = (data.qq_number ?? data.qq ?? "").trim();
  if (!newQQNumber) {
    throw new AppError("QQ number is required", "VALIDATION_ERROR", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, qq_number: true },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  if (!user.qq_number) {
    throw new AppError("Current account has no QQ number bound", "VALIDATION_ERROR", 400);
  }

  if (user.qq_number === newQQNumber) {
    throw new AppError("New QQ number must be different from current QQ number", "VALIDATION_ERROR", 400);
  }

  await assertUniqueAccountIdentifiers({
    username: user.username,
    qqNumber: newQQNumber,
    excludeUserId: user.id,
  });

  const flowPrefix = generateVerificationCode();
  const oldCode = `${flowPrefix}${generateVerificationCode()}`;
  const newCode = `${flowPrefix}${generateVerificationCode()}`;
  const expiresAt = new Date(Date.now() + QQ_REBIND_EXPIRES_MS);

  await prisma.$transaction(async (tx) => {
    await tx.verificationChallenge.updateMany({
      where: {
        used_by: user.id,
        used_at: null,
        OR: [
          { code: { startsWith: QQ_REBIND_OLD_PREFIX } },
          { code: { startsWith: QQ_REBIND_NEW_PREFIX } },
        ],
      },
      data: { used_at: new Date() },
    });

    await tx.verificationChallenge.createMany({
      data: [
        {
          code: toQQRebindOldChallengeCode(oldCode),
          qq_number: user.qq_number || "",
          expires_at: expiresAt,
          used_by: user.id,
        },
        {
          code: toQQRebindNewChallengeCode(newCode),
          qq_number: newQQNumber,
          expires_at: expiresAt,
          used_by: user.id,
        },
      ],
    });
  });

  return {
    success: true,
    oldQQ: user.qq_number,
    newQQ: newQQNumber,
    oldCommand: `/rebindqq-old ${oldCode}`,
    newCommand: `/rebindqq-new ${newCode}`,
    expiresAt,
    expiresInSeconds: QQ_REBIND_EXPIRES_MS / 1000,
  };
}

export async function verifyQQRebindByQQ(data: VerifyQQInput, stage: "old" | "new") {
  const displayCode = data.code.trim();
  const challengeCode =
    stage === "old"
      ? toQQRebindOldChallengeCode(displayCode)
      : toQQRebindNewChallengeCode(displayCode);
  const challenge = await prisma.verificationChallenge.findUnique({
    where: { code: challengeCode },
  });

  if (!challenge) {
    throw new AppError("Invalid QQ rebind code", "NOT_FOUND", 404);
  }

  if (challenge.used_at) {
    throw new AppError("QQ rebind code already used", "CONFLICT", 409);
  }

  if (challenge.expires_at < new Date()) {
    throw new AppError("QQ rebind code expired", "INVALID_REBIND_CODE", 400);
  }

  if (!data.qq_number || data.qq_number !== challenge.qq_number) {
    throw new AppError("QQ number does not match this rebind step", "FORBIDDEN", 403);
  }

  const userId = challenge.used_by;
  if (!userId) {
    throw new AppError("No user associated with this code", "NOT_FOUND", 404);
  }

  if (stage === "old") {
    await prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: { used_at: new Date() },
    });
    return {
      success: true,
      status: "old_verified" as const,
      message: "旧 QQ 已验证，请使用新 QQ 发送换绑确认命令。",
    };
  }

  const flowPrefix = getQQRebindFlowPrefix(displayCode);
  const oldChallenge = await prisma.verificationChallenge.findFirst({
    where: {
      used_by: userId,
      code: { startsWith: `${QQ_REBIND_OLD_PREFIX}${flowPrefix}` },
      used_at: { not: null },
      expires_at: { gte: new Date() },
    },
  });

  if (!oldChallenge) {
    throw new AppError("Please verify with the old QQ number first", "FORBIDDEN", 403);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  await assertUniqueAccountIdentifiers({
    username: user.username,
    qqNumber: challenge.qq_number,
    excludeUserId: user.id,
  });

  const updatedUser = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { qq_number: challenge.qq_number },
      select: {
        id: true,
        username: true,
        nickname: true,
        email: true,
        role: true,
        status: true,
        avatar_url: true,
        qq_number: true,
      },
    });

    await tx.verificationChallenge.updateMany({
      where: {
        used_by: user.id,
        OR: [
          { code: { startsWith: `${QQ_REBIND_OLD_PREFIX}${flowPrefix}` } },
          { code: { startsWith: `${QQ_REBIND_NEW_PREFIX}${flowPrefix}` } },
        ],
      },
      data: { used_at: new Date() },
    });

    return updated;
  });

  return {
    success: true,
    status: "rebound" as const,
    user: updatedUser,
  };
}

export async function getRoleTags() {
  return prisma.roleTag.findMany({
    orderBy: { name: "asc" },
  });
}

export async function createRoleTag(data: CreateRoleTagInput) {
  return prisma.roleTag.create({
    data: {
      name: data.name,
      role_type: data.role_type ?? data.roleType ?? "translation",
      description: data.description,
      color: data.color,
    },
  });
}

export async function updateRoleTag(tagId: string, data: UpdateRoleTagInput) {
  return prisma.roleTag.update({
    where: { id: tagId },
    data: {
      name: data.name,
      role_type: data.role_type ?? data.roleType,
      description: data.description,
      color: data.color,
    },
  });
}

export async function deleteRoleTag(tagId: string) {
  return prisma.roleTag.delete({
    where: { id: tagId },
  });
}

export async function getMyRoleTagStatuses(userId: string) {
  const [tags, applications] = await Promise.all([
    prisma.roleTag.findMany({ orderBy: { name: "asc" } }),
    prisma.tagApplication.findMany({
      where: { user_id: userId },
      include: { tag: true },
      orderBy: { created_at: "desc" },
    }),
  ]);

  return tags.map((tag) => {
    const app = applications.find((a) => a.tag_id === tag.id);
    let status: string;
    if (!app) {
      status = "not_applied";
    } else if (app.approved === true) {
      status = "granted";
    } else if (app.approved === false && app.approved_by) {
      status = "rejected";
    } else {
      status = "pending";
    }
    return { tag, status };
  });
}

export async function getMemberRoleTagStatuses(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  return getMyRoleTagStatuses(userId);
}

export async function createTagApplication(userId: string, data: CreateTagApplicationInput) {
  const existing = await prisma.tagApplication.findUnique({
    where: { user_id_tag_id: { user_id: userId, tag_id: data.tag_id } },
  });
  if (existing) {
    throw new AppError("You have already applied for this tag", "DUPLICATE_ERROR", 409);
  }
  return prisma.tagApplication.create({
    data: {
      user_id: userId,
      tag_id: data.tag_id,
      reason: data.reason,
    },
    include: { tag: true },
  });
}

export async function getMyTagApplications(userId: string) {
  return prisma.tagApplication.findMany({
    where: { user_id: userId },
    include: { tag: true },
    orderBy: { created_at: "desc" },
  });
}

export async function getPendingTagApplications() {
  return prisma.tagApplication.findMany({
    where: { approved: false, approved_by: null },
    include: {
      tag: true,
      user: { select: { id: true, username: true, nickname: true } },
    },
    orderBy: { created_at: "desc" },
  });
}

export async function reviewTagApplication(adminId: string, data: ReviewTagApplicationInput) {
  const application = await prisma.tagApplication.findUnique({
    where: { id: data.application_id },
  });
  if (!application) {
    throw new AppError("Application not found", "NOT_FOUND", 404);
  }
  return prisma.tagApplication.update({
    where: { id: data.application_id },
    data: {
      approved: data.approved,
      approved_by: adminId,
      approved_at: new Date(),
    },
    include: {
      tag: true,
      user: { select: { id: true, username: true, nickname: true } },
    },
  });
}

export async function resetUserTagStatuses(userId: string, data: ResetTagStatusInput) {
  const result = await prisma.tagApplication.deleteMany({
    where: {
      user_id: userId,
      tag_id: { in: data.tagIds },
    },
  });

  return {
    resetCount: result.count,
    statuses: await getMyRoleTagStatuses(userId),
  };
}

/**
 * 超级管理员账号只能由超级管理员本人操作。
 * 任何会改动目标账号权限、状态或凭据的管理端点都必须先过这道闸。
 */
async function assertCanManageTargetAccount(
  target: { role: string },
  actorId?: string
): Promise<{ id: string; role: string }> {
  const actor = actorId
    ? await prisma.user.findUnique({
        where: { id: actorId },
        select: { id: true, role: true },
      })
    : null;

  if (!actor) {
    throw new AppError("Actor not found", "NOT_FOUND", 404);
  }

  if (target.role === "super_admin" && actor.role !== "super_admin") {
    throw new AppError("Only the super administrator can modify that account", "FORBIDDEN", 403);
  }

  return actor;
}

export async function resetMemberTagStatuses(
  userId: string,
  data: ResetTagStatusInput,
  actorId?: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  await assertCanManageTargetAccount(user, actorId);

  await prisma.tagApplication.deleteMany({
    where: {
      user_id: userId,
      tag_id: { in: data.tagIds },
    },
  });

  return getAllUsers();
}

const baseUserSelect = {
  id: true,
  username: true,
  nickname: true,
  avatar_url: true,
  role: true,
  status: true,
  created_at: true,
  tag_applications: {
    where: { approved: true },
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          role_type: true,
          description: true,
          color: true,
          created_at: true,
        },
      },
    },
    orderBy: { created_at: "asc" as const },
  },
};

const privilegedUserSelect = {
  ...baseUserSelect,
  email: true,
  qq_number: true,
};

function canViewUserPii(role?: string | null): boolean {
  return role === "super_admin" || role === "group_admin" || role === "supervisor";
}

function serializeManagedUser<T extends { tag_applications?: Array<{ tag: unknown }> }>(user: T) {
  const { tag_applications, ...rest } = user;
  return {
    ...rest,
    roleTags: tag_applications?.map((application) => application.tag) ?? [],
  };
}

export async function createMember(actorId: string, data: CreateMemberInput) {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { id: true, role: true },
  });

  if (!actor) {
    throw new AppError("Actor not found", "NOT_FOUND", 404);
  }

  if (actor.role === "supervisor" && data.role !== "member") {
    throw new AppError("Supervisors can only create member accounts", "FORBIDDEN", 403);
  }

  if (data.role === "super_admin") {
    if (actor.role !== "super_admin") {
      throw new AppError("Only the super administrator can assign that role", "FORBIDDEN", 403);
    }
    const existingSuperAdmin = await prisma.user.findFirst({
      where: { role: "super_admin" },
      select: { id: true },
    });
    if (existingSuperAdmin) {
      throw new AppError("A super administrator account already exists", "DUPLICATE_ERROR", 409);
    }
  }

  const qqNumber = getMemberQQNumber(data);
  await assertUniqueAccountIdentifiers({
    username: data.username,
    email: data.email,
    qqNumber,
  });

  const uniqueTagIds = [...new Set(data.tagIds ?? [])];
  if (uniqueTagIds.length > 0) {
    const tags = await prisma.roleTag.findMany({
      where: { id: { in: uniqueTagIds } },
      select: { id: true },
    });
    if (tags.length !== uniqueTagIds.length) {
      throw new AppError("One or more role tags do not exist", "VALIDATION_ERROR", 400);
    }
  }

  const passwordHash = await hashPassword(data.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        username: data.username,
        password_hash: passwordHash,
        nickname: data.nickname || data.username,
        email: data.email,
        qq_number: qqNumber,
        role: data.role,
        super_admin_marker: data.role === "super_admin" ? "singleton" : null,
        status: data.status,
      },
      select: privilegedUserSelect,
    });

    for (const tagId of uniqueTagIds) {
      await tx.tagApplication.create({
        data: {
          user_id: created.id,
          tag_id: tagId,
          reason: "Directly assigned by administrator",
          approved: true,
          approved_by: actorId,
          approved_at: new Date(),
        },
      });
    }

    return tx.user.findUniqueOrThrow({
      where: { id: created.id },
      select: privilegedUserSelect,
    });
  });

  return serializeManagedUser(user);
}

export async function updateMemberProfile(
  userId: string,
  actorId: string,
  data: UpdateMemberProfileInput
) {
  const [target, actor] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatar_url: true,
        qq_number: true,
        role: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true },
    }),
  ]);

  if (!target) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }
  if (!actor) {
    throw new AppError("Actor not found", "NOT_FOUND", 404);
  }

  if (target.role === "super_admin" && actor.role !== "super_admin") {
    throw new AppError("Only the super administrator can modify that account", "FORBIDDEN", 403);
  }

  const qqNumber = getUpdateMemberQQNumber(data);
  await assertUniqueAccountIdentifiers({
    username: data.username ?? target.username,
    email: data.email === undefined ? target.email : data.email,
    qqNumber: qqNumber === undefined ? target.qq_number : qqNumber,
    excludeUserId: target.id,
  });

  const updateData: Record<string, unknown> = {};
  if (data.username !== undefined) updateData.username = data.username;
  if (data.nickname !== undefined) updateData.nickname = data.nickname;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.avatar_url !== undefined) updateData.avatar_url = data.avatar_url;
  if (qqNumber !== undefined) updateData.qq_number = qqNumber;

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: updateData,
    select: privilegedUserSelect,
  });

  if (
    data.avatar_url !== undefined &&
    target.avatar_url &&
    target.avatar_url !== data.avatar_url
  ) {
    try {
      await deleteAvatarByUrl(target.avatar_url);
    } catch (error) {
      console.warn(`[Auth] Failed to delete old avatar for user ${target.id}:`, error);
    }
  }

  return serializeManagedUser(updated);
}

export async function grantMemberTagStatuses(
  userId: string,
  actorId: string,
  data: GrantTagStatusInput
) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!target) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  const actor = await assertCanManageTargetAccount(target, actorId);

  const uniqueTagIds = [...new Set(data.tagIds)];
  const tags = await prisma.roleTag.findMany({
    where: { id: { in: uniqueTagIds } },
    select: { id: true },
  });

  if (tags.length !== uniqueTagIds.length) {
    throw new AppError("One or more role tags do not exist", "VALIDATION_ERROR", 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const tagId of uniqueTagIds) {
      await tx.tagApplication.upsert({
        where: { user_id_tag_id: { user_id: target.id, tag_id: tagId } },
        update: {
          reason: "Directly assigned by administrator",
          approved: true,
          approved_by: actor.id,
          approved_at: new Date(),
        },
        create: {
          user_id: target.id,
          tag_id: tagId,
          reason: "Directly assigned by administrator",
          approved: true,
          approved_by: actor.id,
          approved_at: new Date(),
        },
      });
    }

    return tx.user.findUniqueOrThrow({
      where: { id: target.id },
      select: privilegedUserSelect,
    });
  });

  return serializeManagedUser(updated);
}

export async function getAllUsers(requesterRole?: string | null) {
  const select = canViewUserPii(requesterRole) ? privilegedUserSelect : baseUserSelect;
  const users = await prisma.user.findMany({
    select,
    orderBy: { created_at: "desc" },
  });
  return users.map(serializeManagedUser);
}

export async function updateUserRole(userId: string, data: UpdateUserRoleInput, actorId?: string) {
  const [user, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    actorId ? prisma.user.findUnique({ where: { id: actorId } }) : null,
  ]);
  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  if (!actor) {
    throw new AppError("Actor not found", "NOT_FOUND", 404);
  }

  if (actor.id === user.id && actor.role === "super_admin" && data.role !== actor.role) {
    throw new AppError("Super administrators cannot change their own role", "FORBIDDEN", 403);
  }


  if ((user.role === "super_admin" || data.role === "super_admin") && actor.role !== "super_admin") {
    throw new AppError("Only the super administrator can change that role", "FORBIDDEN", 403);
  }

  if (data.role === "super_admin" && user.role !== "super_admin") {
    const existingSuperAdmin = await prisma.user.findFirst({
      where: { role: "super_admin", id: { not: userId } },
      select: { id: true, role: true },
    });
    if (existingSuperAdmin) {
      throw new AppError("A super administrator account already exists", "DUPLICATE_ERROR", 409);
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      role: data.role,
      super_admin_marker: data.role === "super_admin" ? "singleton" : null,
    },
    select: privilegedUserSelect,
  });
  return serializeManagedUser(updated);
}

export async function updateUserStatus(userId: string, data: UpdateUserStatusInput, actorId?: string) {
  const [user, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    actorId ? prisma.user.findUnique({ where: { id: actorId }, select: { role: true } }) : null,
  ]);
  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }
  if (user.role === "super_admin" && actor?.role !== "super_admin") {
    throw new AppError("Only the super administrator can modify that account", "FORBIDDEN", 403);
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: data.status },
    select: privilegedUserSelect,
  });
  return serializeManagedUser(updated);
}

export async function approveUserVerification(userId: string, actorId?: string) {
  const [user, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    actorId ? prisma.user.findUnique({ where: { id: actorId } }) : null,
  ]);

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  if (!actor) {
    throw new AppError("Actor not found", "NOT_FOUND", 404);
  }

  if (user.role === "super_admin" && actor.role !== "super_admin") {
    throw new AppError("Only the super administrator can modify that account", "FORBIDDEN", 403);
  }

  if (user.status !== "pending_verification") {
    throw new AppError("User is not pending verification", "VALIDATION_ERROR", 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.verificationChallenge.updateMany({
      where: {
        used_by: userId,
        used_at: null,
      },
      data: {
        used_by: null,
        used_at: new Date(),
      },
    });

    return tx.user.update({
      where: { id: userId },
      data: { status: "active" },
      select: privilegedUserSelect,
    });
  });

  return serializeManagedUser(updated);
}

export async function resetUserPassword(userId: string, data: ResetUserPasswordInput, actorId?: string) {
  const [user, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    actorId ? prisma.user.findUnique({ where: { id: actorId }, select: { role: true } }) : null,
  ]);
  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  if (user.role === "super_admin" && actor?.role !== "super_admin") {
    throw new AppError("Only the super administrator can modify that account", "FORBIDDEN", 403);
  }

  const newHash = await hashPassword(data.password);
  await prisma.user.update({
    where: { id: userId },
    data: { password_hash: newHash },
  });

  return { success: true };
}

export async function deleteMember(userId: string, actorId?: string) {
  const [user, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    actorId ? prisma.user.findUnique({ where: { id: actorId } }) : null,
  ]);

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
  }

  if (user.role === "super_admin") {
    throw new AppError("Super administrator accounts cannot be deleted", "FORBIDDEN", 403);
  }

  if (actorId === userId) {
    throw new AppError("You cannot delete your own account", "FORBIDDEN", 403);
  }

  if (!actor) {
    throw new AppError("Actor not found", "NOT_FOUND", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.updateMany({
      where: { owner_id: userId },
      data: { owner_id: actor.id },
    });
    await tx.task.updateMany({
      where: { assignee_id: userId },
      data: { assignee_id: null },
    });
    await tx.task.updateMany({
      where: { creator_id: userId },
      data: { creator_id: actor.id },
    });
    await tx.review.updateMany({
      where: { reviewer_id: userId },
      data: { reviewer_id: actor.id },
    });
    await tx.review.updateMany({
      where: { requester_id: userId },
      data: { requester_id: null },
    });
    await tx.fileEntity.updateMany({
      where: { uploader_id: userId },
      data: { uploader_id: actor.id },
    });
    await tx.announcement.updateMany({
      where: { created_by: userId },
      data: { created_by: actor.id },
    });
    await tx.wikiDocument.updateMany({
      where: { created_by: userId },
      data: { created_by: actor.id },
    });
    await tx.downloadLink.updateMany({
      where: { created_by: userId },
      data: { created_by: actor.id },
    });
    await tx.timelineEvent.updateMany({
      where: { actor_id: userId },
      data: { actor_id: null },
    });
    await tx.auditLog.updateMany({
      where: { user_id: userId },
      data: { user_id: null },
    });
    await tx.verificationChallenge.updateMany({
      where: { used_by: userId },
      data: { used_by: null },
    });

    await tx.user.delete({
      where: { id: userId },
    });
  });

  return { deleted: true, id: userId };
}
