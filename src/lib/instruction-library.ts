"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { LibraryInstruction } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";

// Phase 3: instruction_library is the source of truth. Boot empty,
// hydrate from /api/admin/instructions on first mount, mutate via API
// then mirror locally on success. No MOCK seed, no localStorage.

interface RawInstructionRow {
  id: string;
  key: string;
  title_ar: string;
  body_ar: string | null;
  icon: string | null;
  priority: number | null;
  is_active: boolean;
}

let _items: LibraryInstruction[] = [];
let _hydrated = false;
let _remoteHydrated = false;

const listeners = new Set<() => void>();
function emit() {
  _snapshot = null;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

let _snapshot: LibraryInstruction[] | null = null;
function getSnapshot(): LibraryInstruction[] {
  if (!_hydrated) ensureHydrated();
  if (_snapshot) return _snapshot;
  _snapshot = _items;
  return _snapshot;
}

function ensureHydrated() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  void hydrateRemote();
}

async function hydrateRemote() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  if (!USE_SUPABASE) return;
  try {
    const res = await fetch("/api/admin/instructions", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    const rows = (body?.instructions ?? []) as RawInstructionRow[];
    _items = rows.map((r) => ({
      id: r.id,
      key: r.key,
      titleAr: r.title_ar,
      bodyAr: r.body_ar ?? "",
      icon: r.icon ?? "",
      priority: r.priority ?? 50,
      isActive: r.is_active,
    }));
    emit();
  } catch (err) {
    console.warn("[api/admin/instructions] hydrate failed", err);
  }
}

export function getLibraryInstructions(): LibraryInstruction[] { return getSnapshot(); }
export function useLibraryInstructions(): LibraryInstruction[] {
  // useEffect guarantees ensureHydrated() runs even if no other consumer
  // touched the store before the first render of an admin section.
  useEffect(() => { ensureHydrated(); }, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => []);
}

export async function upsertLibraryInstruction(
  item: LibraryInstruction,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!USE_SUPABASE) {
    const exists = _items.find((x) => x.id === item.id);
    _items = exists ? _items.map((x) => (x.id === item.id ? item : x)) : [..._items, item];
    emit();
    return { ok: true };
  }
  try {
    const res = await fetch("/api/admin/instructions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: isUuid(item.id) ? item.id : undefined,
        key: item.key,
        titleAr: item.titleAr,
        bodyAr: item.bodyAr,
        icon: item.icon,
        priority: item.priority,
        isActive: item.isActive,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    const id = (body as { id?: string }).id ?? item.id;
    const next: LibraryInstruction = { ...item, id };
    const exists = _items.find((x) => x.id === id || x.id === item.id);
    _items = exists
      ? _items.map((x) => (x.id === id || x.id === item.id ? next : x))
      : [..._items, next];
    emit();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deleteLibraryInstruction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) {
    _items = _items.filter((x) => x.id !== id);
    emit();
    return { ok: true };
  }
  if (!isUuid(id)) return { ok: false, error: "id must be a uuid" };
  try {
    const res = await fetch(`/api/admin/instructions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    _items = _items.filter((x) => x.id !== id);
    emit();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function setLibraryInstructionActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const found = _items.find((x) => x.id === id);
  if (!found) return { ok: false, error: "instruction not found" };
  return upsertLibraryInstruction({ ...found, isActive });
}
