"use client";
import { useSyncExternalStore } from "react";
import type { AuthSession } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import { apiGetNursePrep, apiSetNursePrep } from "./nurse-api";

// Stage C: per-(nurse, day) prep state lives in nurse_prep_state in Supabase.
// localStorage stays as a write-through cache so flag-off mock mode keeps
// working and the UI doesn't blank during the first hydrate round-trip.
const PREP_KEY = "makhbartak.nurse.prep";
const STARTED_KEY = "makhbartak.nurse.started";

interface PrepEntry {
  started: boolean;
  checkedIds: string[];
}

const _byKey: Map<string, PrepEntry> = new Map();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function localKey(nurseId: string, day: string) { return `${nurseId}::${day}`; }

function loadFromLocal(nurseId: string, day: string): PrepEntry {
  if (typeof window === "undefined") return { started: false, checkedIds: [] };
  try {
    const startedRaw = window.localStorage.getItem(STARTED_KEY + ":" + day);
    const checkedRaw = window.localStorage.getItem(PREP_KEY + ":" + day);
    return {
      started: startedRaw === "1",
      checkedIds: checkedRaw ? (JSON.parse(checkedRaw) as string[]) : [],
    };
  } catch {
    return { started: false, checkedIds: [] };
  }
  void nurseId;
}

function persistLocal(day: string, entry: PrepEntry) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STARTED_KEY + ":" + day, entry.started ? "1" : "0");
    window.localStorage.setItem(PREP_KEY + ":" + day, JSON.stringify(entry.checkedIds));
  } catch {}
}

export function getPrep(nurseId: string, day: string): PrepEntry {
  const key = localKey(nurseId, day);
  if (!_byKey.has(key)) _byKey.set(key, loadFromLocal(nurseId, day));
  return _byKey.get(key)!;
}

export function usePrep(nurseId: string, day: string): PrepEntry {
  return useSyncExternalStore(
    subscribe,
    () => getPrep(nurseId, day),
    () => ({ started: false, checkedIds: [] as string[] }),
  );
}

export async function hydratePrep(nurseId: string, day: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(nurseId)) return;
  const remote = await apiGetNursePrep(nurseId, day);
  if (!remote) return;
  const entry: PrepEntry = { started: remote.started, checkedIds: remote.checkedIds };
  _byKey.set(localKey(nurseId, day), entry);
  persistLocal(day, entry);
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
  _byKey.set(localKey(nurseId, day), next);
  persistLocal(day, next);
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
  return apiSetNursePrep(session, nurseId, day, entry);
}

export function clearPrepForDay(day: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STARTED_KEY + ":" + day);
    window.localStorage.removeItem(PREP_KEY + ":" + day);
  } catch {}
}
