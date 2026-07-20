import type { Application } from "express";
import { createApp } from "../app";
import { prisma, createTestUser } from "./setup";
import { get, post, put, expectError, expectSuccess } from "./helpers";
import { decryptConfig, encryptConfig, generateRecoveryKey, hashRecoveryKey, secureDigest, sha256, verifyRecoveryKey } from "../modules/captcha/captcha.crypto";
import { CloudflareTurnstileProvider, CustomCaptchaProvider, GoogleRecaptchaV2Provider } from "../modules/captcha/captcha.providers";
import { completeAttempt, issueOutageTicket, recoveryLogin, requireVerification, updatePolicy } from "../modules/captcha/captcha.service";
import { refreshToken } from "../modules/auth/auth.service";
import { verifyToken } from "../utils/jwt";

describe("captcha platform", () => {
  let app: Application;

  beforeAll(() => { app = createApp({ databaseReady: true }); });

  describe("sensitive configuration", () => {
    it("encrypts provider credentials with authenticated encryption", () => {
      const config = { siteKey: "public", secretKey: "super-secret-value", allowedHostnames: ["example.com"] };
      const encrypted = encryptConfig(config);
      expect(encrypted).not.toContain(config.secretKey);
      expect(decryptConfig(encrypted)).toEqual(config);
      const parts = encrypted.split(".");
      parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
      expect(() => decryptConfig(parts.join("."))).toThrow();
    });

    it("generates and verifies exactly 32 lowercase alphanumeric recovery characters", async () => {
      const key = generateRecoveryKey();
      expect(key).toMatch(/^(?=.*[a-z])(?=.*\d)[a-z\d]{32}$/);
      const stored = await hashRecoveryKey(key);
      expect(stored.hash).not.toContain(key);
      await expect(verifyRecoveryKey(key, stored.salt, stored.hash)).resolves.toBe(true);
      await expect(verifyRecoveryKey("a1".repeat(16), stored.salt, stored.hash)).resolves.toBe(false);
    });
  });

  describe("vendor provider contract", () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it("returns matching success semantics for Turnstile and reCAPTCHA", async () => {
      global.fetch = jest.fn().mockImplementation(async () => new Response(JSON.stringify({
        success: true,
        hostname: "login.example.com",
        challenge_ts: new Date().toISOString(),
        action: "login",
      }), { status: 200 })) as jest.Mock;
      const turnstile = new CloudflareTurnstileProvider({ siteKey: "site", secretKey: "secret", allowedHostnames: ["login.example.com"], action: "login" });
      const recaptcha = new GoogleRecaptchaV2Provider({ siteKey: "site", secretKey: "secret", allowedHostnames: ["login.example.com"] });
      await expect(turnstile.verify({ token: "token", expectedAction: "login" })).resolves.toEqual({ success: true });
      await expect(recaptcha.verify({ token: "token", expectedAction: "login" })).resolves.toEqual({ success: true });
    });

    it("implements the same presentation and success contract for the custom provider", async () => {
      const provider = new CustomCaptchaProvider({
        baseUrl: "https://captcha.example.com",
        siteId: "site-id",
        secret: "custom-provider-secret-at-least-32-characters",
      });
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          iframeUrl: "https://captcha.example.com/embed/v1/widget?session=session-id#token=widget-token",
          allowedOrigin: "https://captcha.example.com",
          sessionRef: "session-id",
        }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 })) as jest.Mock;
      await expect(provider.prepare({
        usernameDigest: "u".repeat(43),
        action: "login",
        parentOrigin: "https://login.example.com",
        policyVersion: 1,
        level: "medium",
        credentialFailure: false,
      })).resolves.toMatchObject({ kind: "custom_embed", sessionRef: "session-id" });
      await expect(provider.verify({ token: "completion-token", sessionRef: "session-id", expectedAction: "login" })).resolves.toEqual({ success: true });
      const requestHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
      expect(requestHeaders["x-captcha-signature"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(requestHeaders["x-captcha-nonce"]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    });

    it("rejects hostname mismatch, stale challenges and ordinary invalid tokens without outage", async () => {
      const provider = new CloudflareTurnstileProvider({ siteKey: "site", secretKey: "secret", allowedHostnames: ["login.example.com"], action: "login" });
      global.fetch = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        hostname: "attacker.example.com",
        challenge_ts: new Date().toISOString(),
        action: "login",
      }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        hostname: "login.example.com",
        challenge_ts: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        action: "login",
      }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 200 })) as jest.Mock;
      await expect(provider.verify({ token: "one", expectedAction: "login" })).resolves.toEqual({ success: false, errorCode: "HOSTNAME_MISMATCH" });
      await expect(provider.verify({ token: "two", expectedAction: "login" })).resolves.toEqual({ success: false, errorCode: "PROVIDER_TOKEN_EXPIRED" });
      await expect(provider.verify({ token: "three", expectedAction: "login" })).resolves.toEqual({ success: false, errorCode: "INVALID_PROVIDER_TOKEN" });
    });

    it("classifies 5xx and secret errors as provider outages", async () => {
      const provider = new GoogleRecaptchaV2Provider({ siteKey: "site", secretKey: "secret", allowedHostnames: ["login.example.com"] });
      global.fetch = jest.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        "error-codes": ["invalid-input-secret"],
      }), { status: 200 })) as jest.Mock;
      await expect(provider.verify({ token: "one", expectedAction: "login" })).resolves.toEqual({ success: false, unavailable: true, errorCode: "PROVIDER_5XX" });
      await expect(provider.verify({ token: "two", expectedAction: "login" })).resolves.toEqual({ success: false, unavailable: true, errorCode: "PROVIDER_CREDENTIALS" });
    });

    it("keeps action mismatches and HTTP 4xx separate from network and 5xx outages", async () => {
      const provider = new CloudflareTurnstileProvider({ siteKey: "site", secretKey: "secret", allowedHostnames: ["login.example.com"], action: "login" });
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          success: true,
          hostname: "login.example.com",
          challenge_ts: new Date().toISOString(),
          action: "different-action",
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response("", { status: 400 }))
        .mockRejectedValueOnce(new Error("network unavailable")) as jest.Mock;
      await expect(provider.verify({ token: "one", expectedAction: "login" })).resolves.toEqual({ success: false, errorCode: "ACTION_MISMATCH" });
      await expect(provider.verify({ token: "two", expectedAction: "login" })).resolves.toEqual({ success: false, errorCode: "PROVIDER_REQUEST_REJECTED" });
      await expect(provider.verify({ token: "three", expectedAction: "login" })).resolves.toEqual({ success: false, unavailable: true, errorCode: "PROVIDER_NETWORK" });
    });

    it("checks vendor credentials through siteverify without mistaking an invalid challenge for an outage", async () => {
      const provider = new CloudflareTurnstileProvider({ siteKey: "site", secretKey: "secret", allowedHostnames: ["login.example.com"] });
      global.fetch = jest.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-secret"] }), { status: 200 })) as jest.Mock;
      await expect(provider.healthCheck()).resolves.toMatchObject({ status: "healthy" });
      await expect(provider.healthCheck()).resolves.toMatchObject({ status: "misconfigured", errorCode: "PROVIDER_CREDENTIALS" });
    });
  });

  describe("one-time proofs and recovery boundaries", () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    async function storedProvider(recoveryKey = generateRecoveryKey()) {
      const keyHash = await hashRecoveryKey(recoveryKey);
      const profile = await prisma.captchaProviderProfile.create({
        data: {
          name: "Recovery provider",
          type: "turnstile",
          encrypted_config: encryptConfig({
            siteKey: "site",
            secretKey: "secret",
            allowedHostnames: ["login.example.com"],
            action: "login",
          }),
          recovery_key_salt: keyHash.salt,
          recovery_key_hash: keyHash.hash,
          is_active: true,
        },
      });
      await prisma.captchaPolicy.create({
        data: { id: "default", enabled: true, level: "medium", active_provider_id: profile.id, config_version: 1 },
      });
      return { profile, recoveryKey };
    }

    it("allows exactly one concurrent consumer for a local verification proof", async () => {
      const user = await createTestUser();
      const { profile } = await storedProvider();
      const proof = "proof-token-that-must-only-be-consumed-once";
      await prisma.captchaAttempt.create({
        data: {
          provider_id: profile.id,
          provider_type: profile.type,
          username_digest: secureDigest(`username:${user.user.username.toLowerCase()}`),
          ip_digest: secureDigest("ip:127.0.0.1"),
          config_version: 1,
          status: "verified",
          verification_digest: sha256(proof),
          verification_expires_at: new Date(Date.now() + 60_000),
          expires_at: new Date(Date.now() + 60_000),
        },
      });
      const results = await Promise.allSettled([
        requireVerification(user.user.username, proof),
        requireVerification(user.user.username, proof),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    });

    it("reserves a provider attempt before verification and invalidates it after a configuration switch", async () => {
      const { profile } = await storedProvider();
      const attempt = await prisma.captchaAttempt.create({
        data: {
          provider_id: profile.id,
          provider_type: profile.type,
          username_digest: secureDigest("username:operator"),
          ip_digest: secureDigest("ip:127.0.0.1"),
          config_version: 1,
          expires_at: new Date(Date.now() + 60_000),
        },
      });
      let releaseVerification!: () => void;
      let markVerificationStarted!: () => void;
      const verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve; });
      const verificationStarted = new Promise<void>((resolve) => { markVerificationStarted = resolve; });
      global.fetch = jest.fn().mockImplementation(async () => {
        markVerificationStarted();
        await verificationGate;
        return new Response(JSON.stringify({
          success: true,
          hostname: "login.example.com",
          challenge_ts: new Date().toISOString(),
          action: "login",
        }), { status: 200 });
      }) as jest.Mock;
      const first = completeAttempt(attempt.id, "provider-token");
      await verificationStarted;
      await expect(completeAttempt(attempt.id, "provider-token")).rejects.toMatchObject({ code: "CAPTCHA_ATTEMPT_USED" });
      await prisma.captchaPolicy.update({ where: { id: "default" }, data: { config_version: { increment: 1 } } });
      releaseVerification();
      await expect(first).rejects.toMatchObject({ code: "CAPTCHA_CONFIG_CHANGED" });
    });

    it("issues recovery only for a backend-confirmed outage and makes the session non-refreshable and restricted", async () => {
      const admin = await createTestUser({ role: "super_admin" });
      const { profile, recoveryKey } = await storedProvider();
      global.fetch = jest.fn().mockResolvedValue(new Response("", { status: 503 })) as jest.Mock;
      await prisma.captchaProviderProfile.update({
        where: { id: profile.id },
        data: { health_status: "unavailable", health_error_code: "PROVIDER_5XX", last_health_check_at: new Date() },
      });
      const ticket = await issueOutageTicket(admin.user.username, "203.0.113.8");
      const result = await recoveryLogin({
        username: admin.user.username,
        password: admin.password,
        recoveryKey,
        outageTicket: ticket.outageTicket,
        ip: "203.0.113.8",
      });
      expect(verifyToken(result.token).sessionType).toBe("recovery");
      await expect(refreshToken({ refreshToken: result.token })).rejects.toMatchObject({ code: "RECOVERY_SESSION_RESTRICTED" });
      const forbidden = await get(app, "/api/v1/users", result.token);
      expectError(forbidden, 403, "RECOVERY_SESSION_RESTRICTED");
      await expect(recoveryLogin({
        username: admin.user.username,
        password: admin.password,
        recoveryKey,
        outageTicket: ticket.outageTicket,
        ip: "203.0.113.8",
      })).rejects.toMatchObject({ code: "RECOVERY_LOGIN_FAILED" });
    });

    it("does not open recovery when the backend health probe reports the provider healthy", async () => {
      await storedProvider();
      global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
        success: false,
        "error-codes": ["invalid-input-response"],
      }), { status: 200 })) as jest.Mock;
      await expect(issueOutageTicket("operator", "203.0.113.9")).rejects.toMatchObject({ code: "CAPTCHA_PROVIDER_HEALTHY" });
    });

    it("requires two consecutive backend observations before treating 5xx as sustained", async () => {
      await storedProvider();
      global.fetch = jest.fn().mockResolvedValue(new Response("", { status: 503 })) as jest.Mock;
      await expect(issueOutageTicket("operator", "203.0.113.10")).rejects.toMatchObject({ code: "CAPTCHA_OUTAGE_NOT_CONFIRMED" });
      await expect(issueOutageTicket("operator", "203.0.113.10")).resolves.toHaveProperty("outageTicket");
    });

    it("rejects non-super-admin recovery and records only redacted failure metadata", async () => {
      const member = await createTestUser({ role: "member" });
      const { profile, recoveryKey } = await storedProvider();
      await prisma.captchaProviderProfile.update({
        where: { id: profile.id },
        data: { health_status: "unavailable", health_error_code: "PROVIDER_5XX", last_health_check_at: new Date() },
      });
      global.fetch = jest.fn().mockResolvedValue(new Response("", { status: 503 })) as jest.Mock;
      const ticket = await issueOutageTicket(member.user.username, "203.0.113.11");
      await expect(recoveryLogin({
        username: member.user.username,
        password: member.password,
        recoveryKey,
        outageTicket: ticket.outageTicket,
        ip: "203.0.113.11",
      })).rejects.toMatchObject({ code: "RECOVERY_LOGIN_FAILED" });
      const audit = await prisma.auditLog.findFirst({ where: { action: "captcha.recovery_login_failed" } });
      expect(audit?.new_value).toContain("INVALID_CREDENTIALS");
      expect(audit?.new_value).not.toContain(member.password);
      expect(audit?.new_value).not.toContain(recoveryKey);
      expect(audit?.new_value).not.toContain(ticket.outageTicket);
    });

    it("limits a username and IP pair to three failed recovery attempts per 30 minutes", async () => {
      const admin = await createTestUser({ role: "super_admin" });
      const { profile } = await storedProvider();
      await prisma.captchaProviderProfile.update({
        where: { id: profile.id },
        data: { health_status: "unavailable", health_error_code: "PROVIDER_5XX", last_health_check_at: new Date() },
      });
      global.fetch = jest.fn().mockResolvedValue(new Response("", { status: 503 })) as jest.Mock;
      const ticket = await issueOutageTicket(admin.user.username, "203.0.113.12");
      const input = {
        username: admin.user.username,
        password: admin.password,
        recoveryKey: "a1".repeat(16),
        outageTicket: ticket.outageTicket,
        ip: "203.0.113.12",
      };
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await expect(recoveryLogin(input)).rejects.toMatchObject({ code: "RECOVERY_LOGIN_FAILED" });
      }
      expect(await prisma.captchaRecoveryAttempt.count()).toBe(3);
    });

    it("terminates a recovery session immediately after switching to a healthy provider", async () => {
      const admin = await createTestUser({ role: "super_admin" });
      const { profile, recoveryKey } = await storedProvider();
      await prisma.captchaProviderProfile.update({
        where: { id: profile.id },
        data: { health_status: "unavailable", health_error_code: "PROVIDER_5XX", last_health_check_at: new Date() },
      });
      const secondKey = await hashRecoveryKey(generateRecoveryKey());
      const second = await prisma.captchaProviderProfile.create({
        data: {
          name: "Healthy replacement",
          type: "turnstile",
          encrypted_config: profile.encrypted_config,
          recovery_key_salt: secondKey.salt,
          recovery_key_hash: secondKey.hash,
        },
      });
      global.fetch = jest.fn().mockResolvedValue(new Response("", { status: 503 })) as jest.Mock;
      const ticket = await issueOutageTicket(admin.user.username, "203.0.113.13");
      const recovery = await recoveryLogin({
        username: admin.user.username,
        password: admin.password,
        recoveryKey,
        outageTicket: ticket.outageTicket,
        ip: "203.0.113.13",
      });
      global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
        success: false,
        "error-codes": ["invalid-input-response"],
      }), { status: 200 })) as jest.Mock;
      const activated = await post(app, `/api/v1/system/captcha/providers/${second.id}/activate`, {}, recovery.token);
      expectSuccess(activated);
      expect(activated.body.data.recoverySessionTerminated).toBe(true);
      const reused = await get(app, "/api/v1/system/captcha/providers", recovery.token);
      expectError(reused, 401, "UNAUTHORIZED");
    });

    it("increments the configuration version and audits disabling verification", async () => {
      const admin = await createTestUser({ role: "super_admin" });
      await storedProvider();
      const result = await updatePolicy({ enabled: false }, admin.user.id);
      expect(result.enabled).toBe(false);
      expect(result.configVersion).toBe(2);
      const audit = await prisma.auditLog.findFirst({ where: { action: "captcha.disable" } });
      expect(audit?.user_id).toBe(admin.user.id);
      expect(audit?.new_value).toContain('"enabled":false');
    });
  });

  describe("HTTP policy and profile management", () => {
    it("defaults to disabled so existing login remains available", async () => {
      const publicConfig = await get(app, "/api/v1/auth/captcha/public-config");
      expectSuccess(publicConfig);
      expect(publicConfig.body.data.enabled).toBe(false);

      const user = await createTestUser();
      const login = await post(app, "/api/v1/auth/login", { username: user.user.username, password: user.password });
      expectSuccess(login);
      expect(login.body.data.token).toBeTruthy();
    });

    it("only returns the recovery key once and never returns provider secrets", async () => {
      const admin = await createTestUser({ role: "super_admin" });
      const created = await post(app, "/api/v1/system/captcha/providers", {
        name: "Turnstile test",
        type: "turnstile",
        config: { siteKey: "site-key", secretKey: "secret-key", allowedHostnames: ["login.example.com"] },
      }, admin.token);
      expectSuccess(created, 201);
      expect(created.body.data.recoveryKey).toMatch(/^[a-z\d]{32}$/);
      expect(created.body.data.profile.config.secretKey).toBeUndefined();

      const list = await get(app, "/api/v1/system/captcha/providers", admin.token);
      expectSuccess(list);
      expect(JSON.stringify(list.body)).not.toContain("secret-key");
      expect(JSON.stringify(list.body)).not.toContain(created.body.data.recoveryKey);

      const stored = await prisma.captchaProviderProfile.findUnique({ where: { id: created.body.data.profile.id } });
      expect(stored?.encrypted_config).not.toContain("secret-key");
      expect(stored?.recovery_key_hash).not.toContain(created.body.data.recoveryKey);
    });

    it("rotates the recovery key whenever credentials change and on explicit rotation", async () => {
      const admin = await createTestUser({ role: "super_admin" });
      const created = await post(app, "/api/v1/system/captcha/providers", {
        name: "Rotating provider",
        type: "turnstile",
        config: { siteKey: "site-key", secretKey: "first-secret", allowedHostnames: ["login.example.com"] },
      }, admin.token);
      expectSuccess(created, 201);
      const id = created.body.data.profile.id as string;
      const firstKey = created.body.data.recoveryKey as string;
      const updated = await put(app, `/api/v1/system/captcha/providers/${id}`, {
        config: { siteKey: "site-key", secretKey: "second-secret", allowedHostnames: ["login.example.com"] },
      }, admin.token);
      expectSuccess(updated);
      const secondKey = updated.body.data.recoveryKey as string;
      expect(secondKey).not.toBe(firstKey);
      let stored = await prisma.captchaProviderProfile.findUnique({ where: { id } });
      await expect(verifyRecoveryKey(firstKey, stored!.recovery_key_salt, stored!.recovery_key_hash)).resolves.toBe(false);
      await expect(verifyRecoveryKey(secondKey, stored!.recovery_key_salt, stored!.recovery_key_hash)).resolves.toBe(true);
      expect(decryptConfig<{ secretKey: string }>(stored!.encrypted_config).secretKey).toBe("second-secret");

      const rotated = await post(app, `/api/v1/system/captcha/providers/${id}/rotate-recovery-key`, {}, admin.token);
      expectSuccess(rotated);
      stored = await prisma.captchaProviderProfile.findUnique({ where: { id } });
      await expect(verifyRecoveryKey(secondKey, stored!.recovery_key_salt, stored!.recovery_key_hash)).resolves.toBe(false);
      await expect(verifyRecoveryKey(rotated.body.data.recoveryKey, stored!.recovery_key_salt, stored!.recovery_key_hash)).resolves.toBe(true);
    });

    it("requires an active provider before enabling captcha", async () => {
      const admin = await createTestUser({ role: "super_admin" });
      const response = await put(app, "/api/v1/system/captcha/policy", { enabled: true }, admin.token);
      expectError(response, 409, "CAPTCHA_PROVIDER_REQUIRED");
    });

    it("rejects captcha administration for non-super-admin users", async () => {
      const groupAdmin = await createTestUser({ role: "group_admin" });
      const response = await get(app, "/api/v1/system/captcha/providers", groupAdmin.token);
      expectError(response, 403, "FORBIDDEN");
    });
  });
});
