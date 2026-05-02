"use client";
import { useSyncExternalStore } from "react";
import type { LibraryTool, NurseChecklistDefaults } from "./types";
import { MOCK_LIBRARY_TOOLS, NURSE_CHECKLIST_DEFAULTS } from "./mock-data";

const TOOLS_KEY    = "makhbartak.library.tools.v1";
const DEFAULTS_KEY = "makhbartak.library.checklist-defaults.v1";

// ─── Tools ──────────────────────────────────────────────────────────────────
let _tools: LibraryTool[] = [...MOCK_LIBRARY_TOOLS];
let _hydratedTools = false;

const toolListeners = new Set<() => void>();
function emitTools() {
  _toolsSnapshot = null;
  toolListeners.forEach((l) => l());
}
function subscribeTools(l: () => void) { toolListeners.add(l); return () => { toolListeners.delete(l); }; }

function hydrateTools() {
  if (_hydratedTools || typeof window === "undefined") return;
  _hydratedTools = true;
  try {
    const raw = window.localStorage.getItem(TOOLS_KEY);
    if (raw) _tools = JSON.parse(raw) as LibraryTool[];
  } catch {}
  emitTools();
}

function persistTools() {
  try { window.localStorage.setItem(TOOLS_KEY, JSON.stringify(_tools)); } catch {}
}

let _toolsSnapshot: LibraryTool[] | null = null;
function getToolsSnapshot(): LibraryTool[] {
  if (!_hydratedTools) hydrateTools();
  if (_toolsSnapshot) return _toolsSnapshot;
  _toolsSnapshot = _tools;
  return _toolsSnapshot;
}
const _serverTools: LibraryTool[] = [...MOCK_LIBRARY_TOOLS];

export function getLibraryTools(): LibraryTool[] { return getToolsSnapshot(); }
export function useLibraryTools(): LibraryTool[] {
  return useSyncExternalStore(subscribeTools, getToolsSnapshot, () => _serverTools);
}

export function upsertLibraryTool(item: LibraryTool): void {
  if (!_hydratedTools) hydrateTools();
  const exists = _tools.find((x) => x.id === item.id);
  _tools = exists ? _tools.map((x) => x.id === item.id ? item : x) : [..._tools, item];
  persistTools();
  emitTools();
}

export function deleteLibraryTool(id: string): void {
  if (!_hydratedTools) hydrateTools();
  _tools = _tools.filter((x) => x.id !== id);
  persistTools();
  emitTools();
}

export function setLibraryToolActive(id: string, isActive: boolean): void {
  if (!_hydratedTools) hydrateTools();
  _tools = _tools.map((x) => x.id === id ? { ...x, isActive } : x);
  persistTools();
  emitTools();
}

// ─── Checklist defaults (default tools + buffer pct) ────────────────────────
let _defaults: NurseChecklistDefaults = { ...NURSE_CHECKLIST_DEFAULTS };
let _hydratedDefaults = false;

const defaultsListeners = new Set<() => void>();
function emitDefaults() {
  _defaultsSnapshot = null;
  defaultsListeners.forEach((l) => l());
}
function subscribeDefaults(l: () => void) { defaultsListeners.add(l); return () => { defaultsListeners.delete(l); }; }

function hydrateDefaults() {
  if (_hydratedDefaults || typeof window === "undefined") return;
  _hydratedDefaults = true;
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    if (raw) _defaults = { ...NURSE_CHECKLIST_DEFAULTS, ...(JSON.parse(raw) as Partial<NurseChecklistDefaults>) };
  } catch {}
  emitDefaults();
}

let _defaultsSnapshot: NurseChecklistDefaults | null = null;
function getDefaultsSnapshot(): NurseChecklistDefaults {
  if (!_hydratedDefaults) hydrateDefaults();
  if (_defaultsSnapshot) return _defaultsSnapshot;
  _defaultsSnapshot = _defaults;
  return _defaultsSnapshot;
}
const _serverDefaults: NurseChecklistDefaults = { ...NURSE_CHECKLIST_DEFAULTS };

export function getChecklistDefaults(): NurseChecklistDefaults { return getDefaultsSnapshot(); }
export function useChecklistDefaults(): NurseChecklistDefaults {
  return useSyncExternalStore(subscribeDefaults, getDefaultsSnapshot, () => _serverDefaults);
}

export function updateChecklistDefaults(patch: Partial<NurseChecklistDefaults>): void {
  if (!_hydratedDefaults) hydrateDefaults();
  _defaults = { ...getDefaultsSnapshot(), ...patch };
  try { window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(_defaults)); } catch {}
  emitDefaults();
}
