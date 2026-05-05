"use client";
import { useSyncExternalStore } from "react";
import type { SystemSettings } from "./types";
import { SYSTEM_SETTINGS } from "./mock-data";

// STORAGE POLICY (Phase 4 cleanup):
//   * SOURCE OF TRUTH: public.app_settings (Supabase singleton id=1).
//   * SYSTEM_SETTINGS from mock-data is used only as a per-render default
//     so unhydrated reads never crash on `.allowCashOrders` /
//     `.morningShiftStart` lookups.
//   * No localStorage cache. Every mount hydrates from /api/system/settings;
//     the network round-trip is a few milliseconds and the SSR fallback
//     covers the gap.

let _s: SystemSettings | null = null;
let _hydrated = false;
let _remoteHydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function ensureHydrated() {
  if (_hydrated) return;
  _hydrated = true;
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
    emit();
  } catch {
    // Network failure: leave _s at null so the SSR fallback supplies the
    // SYSTEM_SETTINGS constant for this render. The next mount retries.
  }
}

export function getSystemSettings(): SystemSettings {
  if (!_hydrated) ensureHydrated();
  return _s ?? SYSTEM_SETTINGS;
}

export async function updateSystemSettings(patch: Partial<SystemSettings>): Promise<{ ok: boolean; error?: string }> {
  // Optimistic local apply so the admin UI reflects the change instantly.
  _s = { ...getSystemSettings(), ...patch };
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
