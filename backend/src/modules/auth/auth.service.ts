import { prisma } from "../../config/database";
import { hashPassword, comparePassword } from "../../utils/password";
import { signToken, signRefreshToken, verifyToken } from "../../utils/jwt";
import { AppError } from "../../utils/response";
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  UpdateProfileInput,
  VerifyQQInput,
  RefreshTokenInput,
} from "./auth.schema";

function generateVerificationCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function registerUser(data: RegisterInput) {
  // Get current registration policy
  const policy = await prisma.registrationPolicy.findFirst({
    orderBy: { created_at: "desc" },
  });

  const mode = policy?.mode ?? "open";

  if (mode === "disabled") {
    throw new AppError(
      "Registration is currently disabled",
      "REGISTRATION_DISABLED",
      403
    );
  }

  // Check for duplicate username
  const existingUser = await prisma.user.findUnique({
    where: { username: data.username },
  });

  if (existingUser) {
    throw new AppError("Username already taken", "DUPLICATE_ERROR", 409);
  }

  // Check for duplicate email
  if (data.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingEmail) {
      throw new AppError("Email already registered", "DUPLICATE_ERROR", 409);
    }
  }

  const passwordHash = await hashPassword(data.password);

  if (mode === "qq_verification") {
    // Create user with pending verification status
    const user = await prisma.user.create({
      data: {
        username: data.username,
        password_hash: passwordHash,
        nickname: data.nickname || data.username,
        email: data.email,
        qq_number: data.qq_number,
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

    // Generate verification challenge
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.verificationChallenge.create({
      data: {
        code,
        qq_number: data.qq_number || "",
        expires_at: expiresAt,
        used_by: user.id,
      },
    });

    const verifyCommand = policy?.qq_group_number
      ? `/verify ${code}`
      : `/verify ${code}`;

    return {
      user,
      requiresVerification: true,
      qqGroup: policy?.qq_group_number || null,
      verifyCommand,
      copyReady: code,
    };
  }

  // open mode: create active user
  const user = await prisma.user.create({
    data: {
      username: data.username,
      password_hash: passwordHash,
      nickname: data.nickname || data.username,
      email: data.email,
      qq_number: data.qq_number,
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

  return { user, token, refreshToken };
}

export async function loginUser(data: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { username: data.username },
  });

  if (!user) {
    throw new AppError("Invalid credentials", "UNAUTHORIZED", 401);
  }

  const valid = await comparePassword(data.password, user.password_hash);
  if (!valid) {
    throw new AppError("Invalid credentials", "UNAUTHORIZED", 401);
  }

  // Handle pending verification - return special response, NOT a session
  if (user.status === "pending_verification") {
    const policy = await prisma.registrationPolicy.findFirst({
      orderBy: { created_at: "desc" },
    });

    const challenge = await prisma.verificationChallenge.findFirst({
      where: {
        used_by: user.id,
        used_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: "desc" },
    });

    const code = challenge?.code ?? generateVerificationCode();

    // If no active challenge, create a new one
    if (!challenge) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.verificationChallenge.create({
        data: {
          code,
          qq_number: user.qq_number || "",
          expires_at: expiresAt,
          used_by: user.id,
        },
      });
    }

    const verifyCommand = policy?.qq_group_number
      ? `/verify ${code}`
      : `/verify ${code}`;

    return {
      requiresVerification: true,
      qqGroup: policy?.qq_group_number || null,
      verifyCommand,
      copyReady: code,
    };
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

  return {
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      role: user.role,
      avatar_url: user.avatar_url,
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

  if (challenge.expires_at < new Date()) {
    throw new AppError("Verification code expired", "GONE", 410);
  }

  // Validate QQ group matches configured group (if configured)
  const policy = await prisma.registrationPolicy.findFirst({
    orderBy: { created_at: "desc" },
  });

  if (policy?.qq_group_number && data.qq_group) {
    if (data.qq_group !== policy.qq_group_number) {
      throw new AppError(
        "QQ group number does not match configured group",
        "FORBIDDEN",
        403
      );
    }
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
  await prisma.user.update({
    where: { id: userId },
    data: {
      status: "active",
      qq_number: data.qq_number || user.qq_number,
    },
  });

  // Mark challenge as used (clear verification association)
  await prisma.verificationChallenge.update({
    where: { id: challenge.id },
    data: {
      used_at: new Date(),
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
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      role: user.role,
      avatar_url: user.avatar_url,
    },
    token,
    refreshToken,
  };
}

export async function refreshToken(data: RefreshTokenInput) {
  try {
    const payload = verifyToken(data.refreshToken);

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

export async function logoutUser(_userId: string) {
  // In a stateless JWT system, logout is handled client-side by deleting tokens.
  // Server-side we could maintain a token blocklist, but for now we just return success.
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
      bio: true,
      avatar_url: true,
      updated_at: true,
    },
  });

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

  if (!user) {
    // Return success even if user not found to prevent username enumeration
    return {
      success: true,
      message:
        "If an account with that username exists, a reset link has been sent.",
    };
  }

  // Generate a reset token (we reuse the verification challenge mechanism)
  const resetCode = generateVerificationCode() + generateVerificationCode(); // 16 chars
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.verificationChallenge.create({
    data: {
      code: resetCode,
      qq_number: user.qq_number || "",
      expires_at: expiresAt,
      used_by: user.id,
    },
  });

  // In a real system, this would send an email or QQ message
  // For now, we return the token for testing purposes
  return {
    success: true,
    message:
      "If an account with that username exists, a reset link has been sent.",
    // This would normally not be returned - only for development/testing
    resetToken: resetCode,
  };
}
