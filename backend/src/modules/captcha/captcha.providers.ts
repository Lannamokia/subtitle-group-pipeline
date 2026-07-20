import crypto from "crypto";
import {
  CaptchaContext,
  CaptchaPresentation,
  CaptchaProvider,
  CaptchaProviderHealth,
  CaptchaResult,
  CaptchaVerificationInput,
  CustomProviderConfig,
  RecaptchaProviderConfig,
  TurnstileProviderConfig,
} from "./captcha.types";
import { sha256 } from "./captcha.crypto";

const PROVIDER_TIMEOUT_MS = 8_000;

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableHealth(errorCode: string): CaptchaProviderHealth {
  return { status: "unavailable", errorCode, checkedAt: new Date().toISOString() };
}

function hmacHeaders(config: CustomProviderConfig, method: string, path: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const bodyDigest = sha256(body);
  const canonical = [method.toUpperCase(), path, timestamp, nonce, bodyDigest].join("\n");
  const signature = crypto.createHmac("sha256", config.secret).update(canonical).digest("base64url");
  return {
    "content-type": "application/json",
    "x-captcha-site-id": config.siteId,
    "x-captcha-timestamp": timestamp,
    "x-captcha-nonce": nonce,
    "x-captcha-content-sha256": bodyDigest,
    "x-captcha-signature": signature,
  };
}

export class CustomCaptchaProvider implements CaptchaProvider {
  constructor(private readonly config: CustomProviderConfig) {}

  async prepare(context: CaptchaContext): Promise<CaptchaPresentation> {
    const path = `/v1/sites/${encodeURIComponent(this.config.siteId)}/sessions`;
    const body = JSON.stringify(context);
    const response = await request(new URL(path, this.config.baseUrl).toString(), {
      method: "POST",
      headers: hmacHeaders(this.config, "POST", path, body),
      body,
    });
    if (!response.ok) throw new Error(`CUSTOM_SESSION_${response.status}`);
    const payload = await response.json() as { iframeUrl: string; allowedOrigin: string; sessionRef: string };
    return { kind: "custom_embed", ...payload };
  }

  async verify(input: CaptchaVerificationInput): Promise<CaptchaResult> {
    const path = "/v1/verifications/redeem";
    const body = JSON.stringify({ sessionRef: input.sessionRef, token: input.token });
    try {
      const response = await request(new URL(path, this.config.baseUrl).toString(), {
        method: "POST",
        headers: hmacHeaders(this.config, "POST", path, body),
        body,
      });
      if (response.status >= 500) return { success: false, unavailable: true, errorCode: "PROVIDER_5XX" };
      if (!response.ok) return { success: false, errorCode: "INVALID_PROVIDER_TOKEN" };
      const payload = await response.json() as { success: boolean };
      return payload.success ? { success: true } : { success: false, errorCode: "INVALID_PROVIDER_TOKEN" };
    } catch {
      return { success: false, unavailable: true, errorCode: "PROVIDER_NETWORK" };
    }
  }

  async healthCheck(): Promise<CaptchaProviderHealth> {
    const path = `/v1/sites/${encodeURIComponent(this.config.siteId)}/health`;
    try {
      const response = await request(new URL(path, this.config.baseUrl).toString(), {
        method: "GET",
        headers: hmacHeaders(this.config, "GET", path, ""),
      });
      if (response.status === 401 || response.status === 403) {
        return { status: "misconfigured", errorCode: "PROVIDER_CREDENTIALS", checkedAt: new Date().toISOString() };
      }
      if (!response.ok) return unavailableHealth("PROVIDER_5XX");
      return { status: "healthy", checkedAt: new Date().toISOString() };
    } catch {
      return unavailableHealth("PROVIDER_NETWORK");
    }
  }
}

abstract class VendorProvider implements CaptchaProvider {
  abstract prepare(context: CaptchaContext): Promise<CaptchaPresentation>;
  abstract verify(input: CaptchaVerificationInput): Promise<CaptchaResult>;
  abstract healthCheck(): Promise<CaptchaProviderHealth>;
  protected abstract verificationUrl(): string;

  protected async checkCredentials(secretKey: string): Promise<CaptchaProviderHealth> {
    try {
      const body = new URLSearchParams({
        secret: secretKey,
        response: `health-check-${crypto.randomBytes(16).toString("base64url")}`,
      });
      const response = await request(this.verificationUrl(), { method: "POST", body });
      if (response.status >= 500) return unavailableHealth("PROVIDER_5XX");
      if (response.status === 401 || response.status === 403) {
        return { status: "misconfigured", errorCode: "PROVIDER_CREDENTIALS", checkedAt: new Date().toISOString() };
      }
      if (!response.ok) return { status: "healthy", checkedAt: new Date().toISOString() };
      const payload = await response.json() as { "error-codes"?: string[] };
      if (payload["error-codes"]?.some((code) => code === "invalid-input-secret" || code === "missing-input-secret")) {
        return { status: "misconfigured", errorCode: "PROVIDER_CREDENTIALS", checkedAt: new Date().toISOString() };
      }
      return { status: "healthy", checkedAt: new Date().toISOString() };
    } catch {
      return unavailableHealth("PROVIDER_NETWORK");
    }
  }

  protected validateCommon(payload: { success?: boolean; hostname?: string; challenge_ts?: string }, allowedHostnames: string[]): CaptchaResult {
    if (!payload.success) return { success: false, errorCode: "INVALID_PROVIDER_TOKEN" };
    if (!payload.hostname || !allowedHostnames.includes(payload.hostname)) {
      return { success: false, errorCode: "HOSTNAME_MISMATCH" };
    }
    const challengedAt = Date.parse(payload.challenge_ts || "");
    if (!Number.isFinite(challengedAt) || Date.now() - challengedAt > 2 * 60 * 1000 || challengedAt > Date.now() + 60_000) {
      return { success: false, errorCode: "PROVIDER_TOKEN_EXPIRED" };
    }
    return { success: true };
  }
}

export class CloudflareTurnstileProvider extends VendorProvider {
  constructor(private readonly config: TurnstileProviderConfig) { super(); }
  protected verificationUrl() { return this.config.verifyUrl || "https://challenges.cloudflare.com/turnstile/v0/siteverify"; }

  async prepare(context: CaptchaContext): Promise<CaptchaPresentation> {
    return {
      kind: "turnstile",
      siteKey: this.config.siteKey,
      action: this.config.action || context.action,
      appearance: "interaction-only",
    };
  }

  async healthCheck(): Promise<CaptchaProviderHealth> {
    return this.checkCredentials(this.config.secretKey);
  }

  async verify(input: CaptchaVerificationInput): Promise<CaptchaResult> {
    const body = new URLSearchParams({ secret: this.config.secretKey, response: input.token });
    try {
      const response = await request(this.verificationUrl(), { method: "POST", body });
      if (response.status >= 500) return { success: false, unavailable: true, errorCode: "PROVIDER_5XX" };
      if (!response.ok) return { success: false, errorCode: "PROVIDER_REQUEST_REJECTED" };
      const payload = await response.json() as { success?: boolean; hostname?: string; challenge_ts?: string; action?: string; "error-codes"?: string[] };
      if (payload["error-codes"]?.includes("invalid-input-secret")) {
        return { success: false, unavailable: true, errorCode: "PROVIDER_CREDENTIALS" };
      }
      const common = this.validateCommon(payload, this.config.allowedHostnames);
      if (!common.success) return common;
      if (payload.action !== (this.config.action || input.expectedAction)) {
        return { success: false, errorCode: "ACTION_MISMATCH" };
      }
      return { success: true };
    } catch {
      return { success: false, unavailable: true, errorCode: "PROVIDER_NETWORK" };
    }
  }
}

export class GoogleRecaptchaV2Provider extends VendorProvider {
  constructor(private readonly config: RecaptchaProviderConfig) { super(); }
  protected verificationUrl() { return this.config.verifyUrl || "https://www.google.com/recaptcha/api/siteverify"; }

  async prepare(): Promise<CaptchaPresentation> {
    return { kind: "recaptcha_v2_invisible", siteKey: this.config.siteKey, badge: "bottomright" };
  }

  async healthCheck(): Promise<CaptchaProviderHealth> {
    return this.checkCredentials(this.config.secretKey);
  }

  async verify(input: CaptchaVerificationInput): Promise<CaptchaResult> {
    const body = new URLSearchParams({ secret: this.config.secretKey, response: input.token });
    try {
      const response = await request(this.verificationUrl(), { method: "POST", body });
      if (response.status >= 500) return { success: false, unavailable: true, errorCode: "PROVIDER_5XX" };
      if (!response.ok) return { success: false, errorCode: "PROVIDER_REQUEST_REJECTED" };
      const payload = await response.json() as { success?: boolean; hostname?: string; challenge_ts?: string; "error-codes"?: string[] };
      if (payload["error-codes"]?.includes("invalid-input-secret")) {
        return { success: false, unavailable: true, errorCode: "PROVIDER_CREDENTIALS" };
      }
      return this.validateCommon(payload, this.config.allowedHostnames);
    } catch {
      return { success: false, unavailable: true, errorCode: "PROVIDER_NETWORK" };
    }
  }
}

export function createProvider(type: string, config: unknown): CaptchaProvider {
  if (type === "custom") return new CustomCaptchaProvider(config as CustomProviderConfig);
  if (type === "turnstile") return new CloudflareTurnstileProvider(config as TurnstileProviderConfig);
  if (type === "recaptcha_v2_invisible") return new GoogleRecaptchaV2Provider(config as RecaptchaProviderConfig);
  throw new Error("Unsupported captcha provider");
}
