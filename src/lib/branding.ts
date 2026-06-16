"use client";
import { useSyncExternalStore } from "react";
import type { BrandingConfig } from "./types";

// STORAGE POLICY (Phase 4 cleanup):
//   * SOURCE OF TRUTH: public.app_branding (Supabase singleton).
//   * No localStorage. The shell paints with DEFAULT_BRANDING for the few
//     ms before /api/admin/branding lands; the canonical row then replaces
//     it. On a PUT failure we roll the in-memory state back to the
//     previous canonical config and re-emit, so admins always see DB state.

const ph = (seed: string) => `/images/${seed}.jpg`;

export const DEFAULT_BRANDING: BrandingConfig = {
  logos: {
    main:           ph("makhbartak-logo-main"),
    header:         ph("makhbartak-logo-hdr"),
    mobile:         ph("makhbartak-logo-m"),
    desktop:        ph("makhbartak-logo-d"),
    light:          ph("makhbartak-logo-light"),
    favicon:        "/favicon.ico",
    pwaIcon:        ph("makhbartak-pwa"),
    adminDashboard: ph("makhbartak-admin"),
    nurseInterface: ph("makhbartak-nurse"),
    labPortal:      ph("makhbartak-lab"),
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

function ensureHydrated() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
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
    applyToDOM(merged);
    emit();
  } catch {
    // Network failure: keep DEFAULT_BRANDING this render; next mount retries.
  }
}

export function getBranding(): BrandingConfig {
  if (!_hydrated) ensureHydrated();
  return _config;
}

// Admin-side mutator. Optimistic local apply, then persist via the Supabase
// route. On failure we roll back the in-memory state so the admin sees the
// canonical row, not their unsaved draft.
export async function setBranding(next: BrandingConfig): Promise<{ ok: boolean; error?: string }> {
  const previous = _config;
  _config = next;
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
      applyToDOM(previous);
      emit();
      return { ok: false, error: (j as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    _config = previous;
    applyToDOM(previous);
    emit();
    return { ok: false, error: (err as Error).message };
  }
}

export function useBranding() {
  return useSyncExternalStore(subscribe, getBranding, () => DEFAULT_BRANDING);
}
