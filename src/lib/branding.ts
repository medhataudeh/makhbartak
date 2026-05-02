"use client";
import { useSyncExternalStore } from "react";
import type { BrandingConfig } from "./types";

const KEY = "makhbartak.branding.v1";

// Picsum-seeded placeholders so the prototype renders without real assets.
// Admin will replace these with hosted URLs.
const ph = (seed: string, size: number) =>
  `https://picsum.photos/seed/${seed}/${size}/${size}`;

export const DEFAULT_BRANDING: BrandingConfig = {
  logos: {
    main:           ph("makhbartak-logo-main", 256),
    header:         ph("makhbartak-logo-hdr", 96),
    mobile:         ph("makhbartak-logo-m", 192),
    desktop:        ph("makhbartak-logo-d", 256),
    light:          ph("makhbartak-logo-light", 192),
    favicon:        "/favicon.ico",
    pwaIcon:        ph("makhbartak-pwa", 512),
    adminDashboard: ph("makhbartak-admin", 128),
    nurseInterface: ph("makhbartak-nurse", 128),
    labPortal:      ph("makhbartak-lab", 128),
  },
  theme: {
    primary: "#0891B2",
    cta:     "#059669",
    accent:  "#ECFEFF",
  },
  background: "soft-mesh",
};

let _config: BrandingConfig = DEFAULT_BRANDING;
let _hydrated = false;

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrandingConfig>;
      _config = {
        ...DEFAULT_BRANDING,
        ...parsed,
        logos: { ...DEFAULT_BRANDING.logos, ...(parsed.logos ?? {}) },
        theme: { ...DEFAULT_BRANDING.theme, ...(parsed.theme ?? {}) },
      };
    }
  } catch {}
  applyToDOM(_config);
  emit();
}

function applyToDOM(c: BrandingConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", c.theme.primary);
  root.style.setProperty("--brand-cta", c.theme.cta);
  root.style.setProperty("--brand-accent", c.theme.accent);
  root.dataset.bg = c.background;
}

export function getBranding(): BrandingConfig {
  if (!_hydrated) hydrate();
  return _config;
}

export function setBranding(next: BrandingConfig) {
  _config = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  applyToDOM(next);
  emit();
}

export function useBranding() {
  return useSyncExternalStore(subscribe, getBranding, () => DEFAULT_BRANDING);
}
