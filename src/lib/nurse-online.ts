"use client";
import { useSyncExternalStore } from "react";

// Module-local cache for the nurse "is_online" flag. Reads /api/nurses/[id]/online
// once per nurse-id and toggles via /api/nurses/[id]/online POST. Persisted
// server-side; not in localStorage.

let _isOnline = false;
let _hydratedFor: string | null = null;
let _hydrating = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export async function hydrateNurseOnline(nurseId: string): Promise<void> {
  if (_hydratedFor === nurseId || _hydrating) return;
  _hydrating = true;
  try {
    const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/online`, { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    _isOnline = !!body.isOnline;
    _hydratedFor = nurseId;
    emit();
  } finally {
    _hydrating = false;
  }
}

export function getNurseOnline(): boolean {
  return _isOnline;
}

export function useNurseOnline(): boolean {
  return useSyncExternalStore(subscribe, getNurseOnline, () => false);
}

export async function setNurseOnline(
  nurseId: string,
  isOnline: boolean,
): Promise<{ ok: boolean; error?: string }> {
  // Optimistic local toggle, then server round-trip; revert on failure.
  const prev = _isOnline;
  _isOnline = isOnline;
  emit();
  try {
    const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/online`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isOnline }),
    });
    if (!res.ok) {
      _isOnline = prev;
      emit();
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    _isOnline = prev;
    emit();
    return { ok: false, error: err instanceof Error ? err.message : "network" };
  }
}
