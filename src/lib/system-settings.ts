"use client";
import { useSyncExternalStore } from "react";
import type { SystemSettings } from "./types";
import { SYSTEM_SETTINGS } from "./mock-data";

// STORAGE POLICY (final hardening):
//   * SOURCE OF TRUTH: public.app_settings (Supabase singleton id=1).
//   * SYSTEM_SETTINGS from mock-data is only used as a per-render default
//     so unhydrated reads never crash on `.allowCashOrders` /
//     `.morningShiftStart` lookups.
//   * localStorage `makhbartak.system-settings.cache.v1` is a READ-THROUGH
//     first-paint cache. Every successful API hydrate overwrites it; the
//     cache never overrides a fresh API response.

const CACHE_KEY = "makhbartak.system-settings.cache.v1";

let _s: SystemSettings | null = null;
let _hydrated = false;
let _remoteHydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function readCache(): SystemSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return { ...SYSTEM_SETTINGS, ...(JSON.parse(raw) as Partial<SystemSettings>) };
  } catch { return null; }
}

function writeCache(s: SystemSettings) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch {}
}

function ensureHydrated() {
  if (_hydrated) return;
  _hydrated = true;
  // First-paint cache so the customer shell doesn't flicker between two
  // sets of shift hours during the round-trip. Cache never wins over a
  // successful API response.
  const cached = readCache();
  if (cached) { _s = cached; emit(); }
  void hydrateFromApi();
}

async function hydrateFromApi() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  try {
    const res = await fetch("/api/system/settings", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    const remote = body?.settings as Partial<SystemSettings> | null | undefined;
    if (!remote) return;
    _s = { ...SYSTEM_SETTINGS, ...remote };
    writeCache(_s);
    emit();
  } catch {
    // Network failure: keep whatever we already painted from cache or
    // leave _s at null so the SSR fallback supplies SYSTEM_SETTINGS.
  }
}

export function getSystemSettings(): SystemSettings {
  if (!_hydrated) ensureHydrated();
  return _s ?? SYSTEM_SETTINGS;
}

export async function updateSystemSettings(patch: Partial<SystemSettings>): Promise<{ ok: boolean; error?: string }> {
  // Optimistic local apply so the admin UI reflects the change instantly.
  _s = { ...getSystemSettings(), ...patch };
  writeCache(_s);
  emit();
  try {
    const res = await fetch("/api/admin/system/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function useSystemSettings(): SystemSettings {
  return useSyncExternalStore(subscribe, getSystemSettings, () => SYSTEM_SETTINGS);
}
