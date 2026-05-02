"use client";
import { useSyncExternalStore } from "react";
import type { SystemSettings } from "./types";
import { SYSTEM_SETTINGS } from "./mock-data";
import { USE_SUPABASE, supabaseEnvReady } from "./supabase/flags";
import { getSupabaseBrowser } from "./supabase/client";
import { fetchAppSettings } from "./supabase/queries/app-settings";

const KEY = "makhbartak.system-settings.v1";

let _s: SystemSettings = { ...SYSTEM_SETTINGS };
let _hydrated = false;
let _remoteHydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) _s = { ...SYSTEM_SETTINGS, ...(JSON.parse(raw) as Partial<SystemSettings>) };
  } catch {}
  emit();
  hydrateFromSupabase();
}

async function hydrateFromSupabase() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  if (!USE_SUPABASE || !supabaseEnvReady()) return;
  const sb = getSupabaseBrowser();
  if (!sb) return;
  try {
    const remote = await fetchAppSettings(sb);
    if (remote) {
      _s = { ..._s, ...remote };
      emit();
    }
  } catch (err) {
    console.warn("[supabase] app_settings hydrate failed; using local", err);
  }
}

export function getSystemSettings(): SystemSettings {
  if (!_hydrated) hydrate();
  return _s;
}

export function updateSystemSettings(patch: Partial<SystemSettings>): void {
  _s = { ...getSystemSettings(), ...patch };
  try { window.localStorage.setItem(KEY, JSON.stringify(_s)); } catch {}
  emit();
}

export function useSystemSettings(): SystemSettings {
  return useSyncExternalStore(subscribe, getSystemSettings, () => SYSTEM_SETTINGS);
}
