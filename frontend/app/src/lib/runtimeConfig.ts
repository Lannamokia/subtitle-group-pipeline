type RuntimeAppConfig = {
  API_BASE_URL?: string;
  apiBaseUrl?: string;
  BACKEND_PORT?: string | number;
  backendPort?: string | number;
};

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeAppConfig;
  }
}

const DEFAULT_BACKEND_PORT = "3000";
const API_PATH = "/api/v1";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getWindowConfig(): RuntimeAppConfig {
  if (typeof window === "undefined") return {};
  return window.__APP_CONFIG__ ?? {};
}

function getConfiguredApiBaseUrl() {
  const runtimeConfig = getWindowConfig();
  return (
    runtimeConfig.API_BASE_URL ||
    runtimeConfig.apiBaseUrl ||
    import.meta.env.VITE_API_BASE_URL ||
    ""
  ).trim();
}

function getConfiguredBackendPort() {
  const runtimeConfig = getWindowConfig();
  const raw =
    runtimeConfig.BACKEND_PORT ??
    runtimeConfig.backendPort ??
    import.meta.env.VITE_BACKEND_PORT ??
    DEFAULT_BACKEND_PORT;
  const port = String(raw).trim();
  return port ? `:${port.replace(/^:/, "")}` : "";
}

function inferApiBaseUrl() {
  const configured = getConfiguredApiBaseUrl();
  if (configured) return trimTrailingSlash(configured);

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}${getConfiguredBackendPort()}${API_PATH}`;
  }

  return `http://localhost:${DEFAULT_BACKEND_PORT}${API_PATH}`;
}

function absoluteUrl(value: string) {
  if (typeof window !== "undefined") {
    return new URL(value, window.location.origin).toString();
  }
  if (/^https?:\/\//.test(value)) return value;
  return new URL(value, `http://localhost:${DEFAULT_BACKEND_PORT}`).toString();
}

export const API_BASE_URL = inferApiBaseUrl();
export const ABSOLUTE_API_BASE_URL = absoluteUrl(API_BASE_URL);
export const API_ORIGIN = new URL(ABSOLUTE_API_BASE_URL).origin;

export function getApiRequestPath(url?: string) {
  if (!url) return "";
  try {
    const pathname = new URL(url, ABSOLUTE_API_BASE_URL).pathname;
    return pathname.startsWith(API_PATH)
      ? pathname.slice(API_PATH.length)
      : pathname;
  } catch {
    return url;
  }
}

export function toBackendAssetUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^(https?:|data:|blob:)/.test(value)) return value;
  if (value.startsWith("/")) return `${API_ORIGIN}${value}`;
  return value;
}
