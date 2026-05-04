"use client";
import { useSyncExternalStore } from "react";
import type { BrandingConfig } from "./types";

// Phase 1 production hardening: app_branding is now a Supabase singleton.
// localStorage is demoted to a first-paint cache so the shell themes
// instantly on cold load, but DB is the source of truth — every mount
// hydrates from `/api/admin/branding` and overwrites the cache.

const KEY = "makhbartak.branding.v1";

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
let _remoteHydrated = false;

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function applyToDOM(c: BrandingConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", c.theme.primary);
  root.style.setProperty("--brand-cta", c.theme.cta);
  root.style.setProperty("--brand-accent", c.theme.accent);
  root.dataset.bg = c.background;
}

function readCache(): BrandingConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrandingConfig>;
    return {
      ...DEFAULT_BRANDING,
      ...parsed,
      logos: { ...DEFAULT_BRANDING.logos, ...(parsed.logos ?? {}) },
      theme: { ...DEFAULT_BRANDING.theme, ...(parsed.theme ?? {}) },
    };
  } catch { return null; }
}

function writeCache(c: BrandingConfig) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
}

function firstPaint() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  const cached = readCache();
  if (cached) {
    _config = cached;
    applyToDOM(_config);
    emit();
  }
  void hydrateFromSupabase();
}

async function hydrateFromSupabase() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  try {
    const res = await fetch("/api/admin/branding", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    const remote = body?.config as Partial<BrandingConfig> | null | undefined;
    if (!remote) return;
    const merged: BrandingConfig = {
      ...DEFAULT_BRANDING,
      ...remote,
      logos: { ...DEFAULT_BRANDING.logos, ...(remote.logos ?? {}) },
      theme: { ...DEFAULT_BRANDING.theme, ...(remote.theme ?? {}) },
    };
    _config = merged;
    writeCache(merged);
    applyToDOM(merged);
    emit();
  } catch {
    // Keep whatever we already painted from cache on network failure.
  }
}

export function getBranding(): BrandingConfig {
  if (!_hydrated) firstPaint();
  return _config;
}

// Admin-side mutator. Optimistic local apply, then persist via the Supabase
// route. On failure we roll back the in-memory + cache state so the admin
// sees their unsaved draft instead of a half-applied state.
export async function setBranding(next: BrandingConfig): Promise<{ ok: boolean; error?: string }> {
  const previous = _config;
  _config = next;
  writeCache(next);
  applyToDOM(next);
  emit();
  try {
    const res = await fetch("/api/admin/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      _config = previous;
      writeCache(previous);
      applyToDOM(previous);
      emit();
      return { ok: false, error: (j as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    _config = previous;
    writeCache(previous);
    applyToDOM(previous);
    emit();
    return { ok: false, error: (err as Error).message };
  }
}

export function useBranding() {
  return useSyncExternalStore(subscribe, getBranding, () => DEFAULT_BRANDING);
}
