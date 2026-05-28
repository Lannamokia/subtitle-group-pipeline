import { prisma } from "../../config/database";
import { hashPassword, comparePassword } from "../../utils/password";
import { signToken, signRefreshToken } from "../../utils/jwt";
import { AppError } from "../../utils/response";
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  UpdateProfileInput,
} from "./auth.schema";

export async function registerUser(data: RegisterInput) {
  const existingUser = await prisma.user.findUnique({
    where: { username: data.username },
  });

  if (existingUser) {
    throw new AppError("Username already taken", "DUPLICATE_ERROR", 409);
  }

  if (data.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingEmail) {
      throw new AppError("Email already registered", "DUPLICATE_ERROR", 409);
    }
  }

  const passwordHash = await hashPassword(data.password);

  const user = await prisma.user.create({
    data: {
      username: data.username,
      password_hash: passwordHash,
      nickname: data.nickname || data.username,
      email: data.email,
      qq_number: data.qq_number,
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

  if (user.status === "suspended") {
    throw new AppError("Account suspended", "FORBIDDEN", 403);
  }

  if (user.status === "inactive") {
    throw new AppError("Account inactive", "FORBIDDEN", 403);
  }

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
    },
  });

  if (!user) {
    throw new AppError("User not found", "NOT_FOUND", 404);
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

export async function updateProfile(
  userId: string,
  data: UpdateProfileInput
) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      nickname: data.nickname,
      email: data.email,
      bio: data.bio,
      avatar_url: data.avatar_url,
    },
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
