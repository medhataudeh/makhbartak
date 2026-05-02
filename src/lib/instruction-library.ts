"use client";
import { useSyncExternalStore } from "react";
import type { LibraryInstruction } from "./types";
import { MOCK_LIBRARY_INSTRUCTIONS } from "./mock-data";

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

export function upsertLibraryInstruction(item: LibraryInstruction): void {
  if (!_hydrated) hydrate();
  const exists = _items.find((x) => x.id === item.id);
  _items = exists
    ? _items.map((x) => x.id === item.id ? item : x)
    : [..._items, item];
  persist();
  emit();
}

export function deleteLibraryInstruction(id: string): void {
  if (!_hydrated) hydrate();
  _items = _items.filter((x) => x.id !== id);
  persist();
  emit();
}

export function setLibraryInstructionActive(id: string, isActive: boolean): void {
  if (!_hydrated) hydrate();
  _items = _items.map((x) => x.id === id ? { ...x, isActive } : x);
  persist();
  emit();
}
