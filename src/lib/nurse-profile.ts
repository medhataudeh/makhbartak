"use client";
import { useSyncExternalStore } from "react";
import type { Nurse } from "./types";
import { MOCK_NURSES } from "./mock-data";

const KEY = "makhbartak.nurse-profile.v1";

interface NurseProfileOverrides {
  /** Edits applied on top of the seeded MOCK_NURSES rows by id. */
  byId: Record<string, Partial<Nurse>>;
}

let _state: NurseProfileOverrides = { byId: {} };
let _hydrated = false;
const listeners = new Set<() => void>();
function emit() {
  // Bump cached snapshots so they recompute on next read.
  _composedCache = null;
  _byIdCache.clear();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) _state = JSON.parse(raw) as NurseProfileOverrides;
  } catch {}
  emit();
}

function persist() {
  try { window.localStorage.setItem(KEY, JSON.stringify(_state)); } catch {}
}

// ─── Cached snapshots ───────────────────────────────────────────────────────
// useSyncExternalStore requires getSnapshot to return a stable reference until
// the store changes. Build the composed list (and per-id lookups) lazily and
// cache them; emit() invalidates the cache.
let _composedCache: Nurse[] | null = null;
const _byIdCache = new Map<string, Nurse | null>();

function compose(): Nurse[] {
  if (!_hydrated) hydrate();
  if (_composedCache) return _composedCache;
  _composedCache = MOCK_NURSES.map((n) => ({ ...n, ..._state.byId[n.id] }));
  return _composedCache;
}

function composeOne(id: string): Nurse | null {
  if (_byIdCache.has(id)) return _byIdCache.get(id)!;
  const found = compose().find((n) => n.id === id) ?? null;
  _byIdCache.set(id, found);
  return found;
}

// SSR fallbacks must also be stable references — wrap once.
const _serverList: Nurse[] = [...MOCK_NURSES];
const _serverByIdCache = new Map<string, Nurse | null>();
function serverOne(id: string): Nurse | null {
  if (_serverByIdCache.has(id)) return _serverByIdCache.get(id)!;
  const found = MOCK_NURSES.find((n) => n.id === id) ?? null;
  _serverByIdCache.set(id, found);
  return found;
}

export function getEditableNurses(): Nurse[] {
  return compose();
}

export function useEditableNurses(): Nurse[] {
  return useSyncExternalStore(subscribe, compose, () => _serverList);
}

export function useEditableNurse(id: string): Nurse | null {
  return useSyncExternalStore(
    subscribe,
    () => composeOne(id),
    () => serverOne(id),
  );
}

export interface NurseEditableFields {
  name?: string;
  photoUrl?: string;
  city?: string;
  /** Phone is intentionally not here — locked field, edited only by admin. */
}

export function updateNurseProfile(id: string, patch: NurseEditableFields): void {
  if (!_hydrated) hydrate();
  const existing = _state.byId[id] ?? {};
  _state = { byId: { ..._state.byId, [id]: { ...existing, ...patch } } };
  persist();
  emit();
}
