"use client";
import { useSyncExternalStore } from "react";
import type { AuthSession } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import { apiGetNursePrep, apiSetNursePrep } from "./nurse-api";

// Phase 3 production hardening: nurse_prep_state in Supabase is the only
// source of truth for a nurse's per-day checklist. The store starts empty
// and hydrates via apiGetNursePrep (called once on mount in NurseApp);
// every check flips through apiSetNursePrep before mirroring locally.
//
// We no longer touch localStorage. A stale device that's never been
// online sees "no checks yet" instead of pretending the day was prepped.

interface PrepEntry {
  started: boolean;
  checkedIds: string[];
}

const _byKey: Map<string, PrepEntry> = new Map();
const _hydratedKeys = new Set<string>();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function localKey(nurseId: string, day: string) { return `${nurseId}::${day}`; }

const EMPTY: PrepEntry = { started: false, checkedIds: [] };

export function getPrep(nurseId: string, day: string): PrepEntry {
  return _byKey.get(localKey(nurseId, day)) ?? EMPTY;
}

export function usePrep(nurseId: string, day: string): PrepEntry {
  return useSyncExternalStore(
    subscribe,
    () => getPrep(nurseId, day),
    () => EMPTY,
  );
}

export async function hydratePrep(nurseId: string, day: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(nurseId)) return;
  const key = localKey(nurseId, day);
  if (_hydratedKeys.has(key)) return;
  _hydratedKeys.add(key);
  const remote = await apiGetNursePrep(nurseId, day);
  if (!remote) return;
  _byKey.set(key, { started: remote.started, checkedIds: remote.checkedIds });
  emit();
}

export function setPrep(
  nurseId: string,
  day: string,
  patch: Partial<PrepEntry>,
): Promise<{ ok: boolean; error?: string }> {
  const current = getPrep(nurseId, day);
  const next: PrepEntry = {
    started: patch.started ?? current.started,
    checkedIds: patch.checkedIds ?? current.checkedIds,
  };
  // Optimistic local apply so the checkbox reflects immediately.
  _byKey.set(localKey(nurseId, day), next);
  emit();
  return persistPrepViaApi(nurseId, day, next);
}

async function persistPrepViaApi(
  nurseId: string,
  day: string,
  entry: PrepEntry,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(nurseId)) return { ok: true };
  const session: AuthSession | null = (await import("./auth")).getStoredSession();
  if (!session || (session.role !== "nurse" && session.role !== "admin")) return { ok: true };
  return apiSetNursePrep(nurseId, day, entry);
}
