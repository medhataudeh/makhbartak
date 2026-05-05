"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { LibraryTool, NurseChecklistDefaults } from "./types";
import { NURSE_CHECKLIST_DEFAULTS } from "./mock-data";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";

// Phase 3: nurse_tools is the source of truth for the admin tool catalog.
// Boot empty, hydrate from /api/admin/nurse-tools on first mount.
//
// Checklist *defaults* (default tools + buffer pct) remain a static
// constant for now — admin editing of those defaults is deferred to a
// future phase that introduces a dedicated table. The previous local-only
// `updateChecklistDefaults` was a no-op as far as cross-device sync goes
// and has been removed; admin still sees the constant values.

interface RawToolRow {
  id: string;
  name_ar: string;
  unit: string;
  is_active: boolean;
}

let _tools: LibraryTool[] = [];
let _hydratedTools = false;
let _remoteHydratedTools = false;

const toolListeners = new Set<() => void>();
function emitTools() {
  _toolsSnapshot = null;
  toolListeners.forEach((l) => l());
}
function subscribeTools(l: () => void) { toolListeners.add(l); return () => { toolListeners.delete(l); }; }

let _toolsSnapshot: LibraryTool[] | null = null;
function getToolsSnapshot(): LibraryTool[] {
  if (!_hydratedTools) ensureToolsHydrated();
  if (_toolsSnapshot) return _toolsSnapshot;
  _toolsSnapshot = _tools;
  return _toolsSnapshot;
}

function ensureToolsHydrated() {
  if (_hydratedTools || typeof window === "undefined") return;
  _hydratedTools = true;
  void hydrateToolsRemote();
}

async function hydrateToolsRemote() {
  if (_remoteHydratedTools) return;
  _remoteHydratedTools = true;
  if (!USE_SUPABASE) return;
  try {
    const res = await fetch("/api/admin/nurse-tools", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    const rows = (body?.tools ?? []) as RawToolRow[];
    _tools = rows.map((r) => ({
      id: r.id,
      nameAr: r.name_ar,
      unit: r.unit,
      isActive: r.is_active,
    }));
    emitTools();
  } catch (err) {
    console.warn("[api/admin/nurse-tools] hydrate failed", err);
  }
}

export function getLibraryTools(): LibraryTool[] { return getToolsSnapshot(); }
export function useLibraryTools(): LibraryTool[] {
  useEffect(() => { ensureToolsHydrated(); }, []);
  return useSyncExternalStore(subscribeTools, getToolsSnapshot, () => []);
}

export async function upsertLibraryTool(
  item: LibraryTool,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!USE_SUPABASE) {
    const exists = _tools.find((x) => x.id === item.id);
    _tools = exists ? _tools.map((x) => (x.id === item.id ? item : x)) : [..._tools, item];
    emitTools();
    return { ok: true };
  }
  try {
    const res = await fetch("/api/admin/nurse-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: isUuid(item.id) ? item.id : undefined,
        nameAr: item.nameAr,
        unit: item.unit,
        isActive: item.isActive,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    const id = (body as { id?: string }).id ?? item.id;
    const next: LibraryTool = { ...item, id };
    const exists = _tools.find((x) => x.id === id || x.id === item.id);
    _tools = exists
      ? _tools.map((x) => (x.id === id || x.id === item.id ? next : x))
      : [..._tools, next];
    emitTools();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deleteLibraryTool(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) {
    _tools = _tools.filter((x) => x.id !== id);
    emitTools();
    return { ok: true };
  }
  if (!isUuid(id)) return { ok: false, error: "id must be a uuid" };
  try {
    const res = await fetch(`/api/admin/nurse-tools/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    _tools = _tools.filter((x) => x.id !== id);
    emitTools();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function setLibraryToolActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const found = _tools.find((x) => x.id === id);
  if (!found) return { ok: false, error: "tool not found" };
  return upsertLibraryTool({ ...found, isActive });
}

// ─── Checklist defaults (constant; no localStorage, no DB editing) ─────────
export function getChecklistDefaults(): NurseChecklistDefaults { return NURSE_CHECKLIST_DEFAULTS; }
export function useChecklistDefaults(): NurseChecklistDefaults {
  return NURSE_CHECKLIST_DEFAULTS;
}

// Kept as a no-op so existing admin call sites compile until the dedicated
// migration ships. The function always returns false so admins know the
// change wasn't persisted.
export function updateChecklistDefaults(_patch: Partial<NurseChecklistDefaults>): { ok: false; error: string } {
  void _patch;
  return { ok: false, error: "تعديل الإعدادات الافتراضية غير مربوط بقاعدة البيانات بعد" };
}
