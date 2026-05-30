import { create } from "zustand";
import { systemApi } from "@/lib/api";
import type { SystemBrandingSettings } from "@/types";

const DEFAULT_BRANDING: SystemBrandingSettings = {
  appName: "SubtitleSync",
  logoUrl: null,
  logoUpdatedAt: null,
};

interface BrandingState {
  branding: SystemBrandingSettings;
  loading: boolean;
  loadBranding: () => Promise<SystemBrandingSettings>;
  setBranding: (branding: SystemBrandingSettings) => void;
}

function resolveLogoUrl(logoUrl?: string | null) {
  if (!logoUrl) return null;
  if (/^https?:\/\//.test(logoUrl)) return logoUrl;
  return `http://localhost:3000${logoUrl}`;
}

function applyDocumentBranding(branding: SystemBrandingSettings) {
  document.title = branding.appName || DEFAULT_BRANDING.appName;

  const logoUrl = resolveLogoUrl(branding.logoUrl);
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.appendChild(icon);
  }

  if (logoUrl) {
    icon.href = logoUrl;
  } else {
    icon.removeAttribute("href");
  }
}

export function getBrandLogoUrl(branding: SystemBrandingSettings) {
  return resolveLogoUrl(branding.logoUrl);
}

export const useBrandingStore = create<BrandingState>((set, get) => ({
  branding: DEFAULT_BRANDING,
  loading: false,

  loadBranding: async () => {
    set({ loading: true });
    try {
      const branding = await systemApi.getBranding();
      get().setBranding(branding);
      return branding;
    } catch {
      applyDocumentBranding(DEFAULT_BRANDING);
      set({ branding: DEFAULT_BRANDING });
      return DEFAULT_BRANDING;
    } finally {
      set({ loading: false });
    }
  },

  setBranding: (branding) => {
    const normalized = {
      appName: branding.appName || DEFAULT_BRANDING.appName,
      logoUrl: branding.logoUrl ?? null,
      logoUpdatedAt: branding.logoUpdatedAt ?? null,
    };
    applyDocumentBranding(normalized);
    set({ branding: normalized });
  },
}));
