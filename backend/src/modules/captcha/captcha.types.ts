export type CaptchaProviderType = "custom" | "turnstile" | "recaptcha_v2_invisible";
export type CaptchaPolicyLevel = "low" | "medium" | "high";

export interface CaptchaContext {
  usernameDigest: string;
  action: "login";
  parentOrigin: string;
  policyVersion: number;
  level: CaptchaPolicyLevel;
  credentialFailure: boolean;
  theme?: "light" | "dark";
  brandColor?: string;
}

export type CaptchaPresentation =
  | { kind: "custom_embed"; iframeUrl: string; allowedOrigin: string; sessionRef: string }
  | { kind: "turnstile"; siteKey: string; action: string; appearance: "interaction-only" }
  | { kind: "recaptcha_v2_invisible"; siteKey: string; badge: "bottomright" }
  | { kind: "disabled" };

export interface CaptchaVerificationInput {
  token: string;
  sessionRef?: string;
  expectedAction: string;
}

export interface CaptchaResult {
  success: boolean;
  errorCode?: string;
  unavailable?: boolean;
}

export interface CaptchaProviderHealth {
  status: "healthy" | "unavailable" | "misconfigured";
  errorCode?: string;
  checkedAt: string;
}

export interface CaptchaProvider {
  prepare(context: CaptchaContext): Promise<CaptchaPresentation>;
  verify(input: CaptchaVerificationInput): Promise<CaptchaResult>;
  healthCheck(): Promise<CaptchaProviderHealth>;
}

export interface CustomProviderConfig {
  baseUrl: string;
  siteId: string;
  secret: string;
}

export interface TurnstileProviderConfig {
  siteKey: string;
  secretKey: string;
  allowedHostnames: string[];
  action?: string;
  verifyUrl?: string;
}

export interface RecaptchaProviderConfig {
  siteKey: string;
  secretKey: string;
  allowedHostnames: string[];
  verifyUrl?: string;
}
