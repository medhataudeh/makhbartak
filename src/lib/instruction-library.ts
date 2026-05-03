"use client";
import { useSyncExternalStore } from "react";
import type { LibraryInstruction } from "./types";
import { MOCK_LIBRARY_INSTRUCTIONS } from "./mock-data";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";

const KEY = "makhbartak.library.instructions.v1";

let _items: LibraryInstruction[] = [...MOCK_LIBRARY_INSTRUCTIONS];
let _hydrated = false;

const listeners = new Set<() => void>();
function emit() {
  // Cached snapshot identity must change for useSyncExternalStore to re-read.
  _snapshot = null;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) _items = JSON.parse(raw) as LibraryInstruction[];
  } catch {}
  emit();
}

function persist() {
  try { window.localStorage.setItem(KEY, JSON.stringify(_items)); } catch {}
}

// Cached snapshot — useSyncExternalStore needs a stable reference until
// the data actually changes.
let _snapshot: LibraryInstruction[] | null = null;
function getSnapshot(): LibraryInstruction[] {
  if (!_hydrated) hydrate();
  if (_snapshot) return _snapshot;
  _snapshot = _items;
  return _snapshot;
}
const _serverSnapshot: LibraryInstruction[] = [...MOCK_LIBRARY_INSTRUCTIONS];
function getServerSnapshot(): LibraryInstruction[] { return _serverSnapshot; }

export function getLibraryInstructions(): LibraryInstruction[] { return getSnapshot(); }
export function useLibraryInstructions(): LibraryInstruction[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function upsertLibraryInstruction(item: LibraryInstruction): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!_hydrated) hydrate();
  const exists = _items.find((x) => x.id === item.id);
  _items = exists
    ? _items.map((x) => x.id === item.id ? item : x)
    : [..._items, item];
  persist();
  emit();
  return persistInstructionViaApi(item);
}

async function persistInstructionViaApi(
  item: LibraryInstruction,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { ok: true, id: body.id };
}

export function deleteLibraryInstruction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!_hydrated) hydrate();
  _items = _items.filter((x) => x.id !== id);
  persist();
  emit();
  return persistDeleteInstructionViaApi(id);
}

async function persistDeleteInstructionViaApi(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(id)) return { ok: true };
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  const res = await fetch(`/api/admin/instructions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export function setLibraryInstructionActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!_hydrated) hydrate();
  const found = _items.find((x) => x.id === id);
  _items = _items.map((x) => x.id === id ? { ...x, isActive } : x);
  persist();
  emit();
  if (!found) return Promise.resolve({ ok: true });
  return persistInstructionViaApi({ ...found, isActive });
}
