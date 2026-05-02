"use client";
import { useSyncExternalStore } from "react";
import type { Lab } from "./types";
import { MOCK_LABS } from "./mock-data";

const KEY = "makhbartak.lab-overrides.v1";

// Critical fields — only main admin may change these. Lab admin may not.
export const CRITICAL_LAB_FIELDS = [
  "officialName", "registrationNumber", "licenseNumber", "taxNumber",
  "addressFull", "lat", "lng", "revealSellPriceToLab",
] as const;
export type CriticalLabField = typeof CRITICAL_LAB_FIELDS[number];

interface State { byId: Record<string, Partial<Lab>> }
let _state: State = { byId: {} };
let _hydrated = false;

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) _state = JSON.parse(raw) as State;
  } catch {}
  emit();
}

function compose(): Lab[] {
  if (!_hydrated) hydrate();
  return MOCK_LABS.map((l) => ({ ...l, ..._state.byId[l.id] }));
}

export function getEditableLabs(): Lab[] { return compose(); }
export function getEditableLab(id: string): Lab | null {
  return compose().find((l) => l.id === id) ?? null;
}

export function useEditableLab(id: string): Lab | null {
  return useSyncExternalStore(
    subscribe,
    () => getEditableLab(id),
    () => MOCK_LABS.find((l) => l.id === id) ?? null,
  );
}

/** Lab-admin update — strips critical fields if accidentally included. */
export function updateLabSelf(id: string, patch: Partial<Lab>): void {
  const safe: Partial<Lab> = { ...patch };
  for (const f of CRITICAL_LAB_FIELDS) {
    delete (safe as Record<string, unknown>)[f];
  }
  if (!_hydrated) hydrate();
  _state = { byId: { ..._state.byId, [id]: { ...(_state.byId[id] ?? {}), ...safe } } };
  try { window.localStorage.setItem(KEY, JSON.stringify(_state)); } catch {}
  emit();
}
