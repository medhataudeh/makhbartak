"use client";
import { useSyncExternalStore } from "react";
import type { AuthSession, Nurse } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import { apiUpdateNurseProfile } from "./nurse-api";

// Phase 3: nurse profile edits go straight to the API; we no longer keep
// MOCK_NURSES + localStorage as the source. The store starts empty;
// AdminDashboard hydrates the full list via hydrateAdminNurses; per-nurse
// reads (NurseApp) get the canonical row from the session-enriched
// /api/me payload, and updates flow through /api/nurses/[id]/profile.

interface NurseProfileOverrides {
  byId: Record<string, Partial<Nurse>>;
}

let _state: NurseProfileOverrides = { byId: {} };
const listeners = new Set<() => void>();
function emit() {
  _composedCache = null;
  _byIdCache.clear();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

let _composedCache: Nurse[] | null = null;
const _byIdCache = new Map<string, Nurse | null>();

function compose(): Nurse[] {
  if (_composedCache) return _composedCache;
  // Build a list of nurse-shaped rows from the override map. Without a
  // hydrated upstream nurse list, this is empty until admin imports.
  _composedCache = Object.entries(_state.byId).map(([id, patch]): Nurse => ({
    id,
    name: patch.name ?? "—",
    phone: patch.phone ?? "",
    city: patch.city ?? "",
    photoUrl: patch.photoUrl,
    isActive: patch.isActive ?? true,
  }));
  return _composedCache;
}

function composeOne(id: string): Nurse | null {
  if (_byIdCache.has(id)) return _byIdCache.get(id)!;
  const patch = _state.byId[id];
  if (!patch) {
    _byIdCache.set(id, null);
    return null;
  }
  const nurse: Nurse = {
    id,
    name: patch.name ?? "—",
    phone: patch.phone ?? "",
    city: patch.city ?? "",
    photoUrl: patch.photoUrl,
    isActive: patch.isActive ?? true,
  };
  _byIdCache.set(id, nurse);
  return nurse;
}

export function getEditableNurses(): Nurse[] { return compose(); }

export function useEditableNurses(): Nurse[] {
  return useSyncExternalStore(subscribe, compose, () => []);
}

export function useEditableNurse(id: string): Nurse | null {
  return useSyncExternalStore(
    subscribe,
    () => composeOne(id),
    () => null,
  );
}

export interface NurseEditableFields {
  name?: string;
  photoUrl?: string;
  city?: string;
}

export async function updateNurseProfile(
  id: string,
  patch: NurseEditableFields,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) {
    const existing = _state.byId[id] ?? {};
    _state = { byId: { ..._state.byId, [id]: { ...existing, ...patch } } };
    emit();
    return { ok: true };
  }
  if (!isUuid(id)) {
    return { ok: false, error: "تعذر حفظ الملف الشخصي، الممرض غير موجود في قاعدة البيانات" };
  }
  const session: AuthSession | null = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "nurse" && session.role !== "admin")) {
    return { ok: false, error: "session not authenticated" };
  }
  const result = await apiUpdateNurseProfile(id, {
    name: patch.name,
    city: patch.city,
    photoUrl: patch.photoUrl,
  });
  if (!result.ok) {
    console.warn("[api/nurses/profile] failed", result.error);
    return { ok: false, error: result.error };
  }
  // Mirror locally only after the server confirms.
  const existing = _state.byId[id] ?? {};
  _state = { byId: { ..._state.byId, [id]: { ...existing, ...patch } } };
  emit();
  return { ok: true };
}
