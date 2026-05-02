"use client";
import { useSyncExternalStore } from "react";
import type { SystemSettings } from "./types";
import { SYSTEM_SETTINGS } from "./mock-data";

const KEY = "makhbartak.system-settings.v1";

let _s: SystemSettings = { ...SYSTEM_SETTINGS };
let _hydrated = false;
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
