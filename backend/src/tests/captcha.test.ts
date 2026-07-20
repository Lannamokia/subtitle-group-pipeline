import type { Application } from "express";
import { createApp } from "../app";
import { prisma, createTestUser } from "./setup";
import { get, post, put, expectError, expectSuccess } from "./helpers";
import { decryptConfig, encryptConfig, generateRecoveryKey, hashRecoveryKey, verifyRecoveryKey } from "../modules/captcha/captcha.crypto";
import { CloudflareTurnstileProvider, GoogleRecaptchaV2Provider } from "../modules/captcha/captcha.providers";

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
