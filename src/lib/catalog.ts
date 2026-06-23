"use client";
import { useSyncExternalStore } from "react";
import type { Test, Package, TestCategory } from "./types";
import { TEST_CATEGORIES } from "./mock-data";
import { USE_SUPABASE, supabaseEnvReady } from "./supabase/flags";
import { getSupabaseBrowser } from "./supabase/client";
import {
  fetchTests,
  fetchPackages,
  fetchCategories,
} from "./supabase/queries/catalog";

// Phase 2 production hardening: customer catalog is strictly DB-driven.
// Tests + packages start empty (no MOCK_TESTS / MOCK_PACKAGES fallback
// anywhere on the customer surface). If the DB is empty, the customer
// shell stays empty and the UI surfaces an Arabic admin-instruction
// banner. `useCatalogStatus()` lets consumers distinguish "loading" from
// "DB returned empty".
//
// Categories continue to use a static fallback (TEST_CATEGORIES) because
// admin CRUD for categories isn't wired yet; promotion to a proper table
// is tracked separately.
let _tests: Test[] = [];
let _packages: Package[] = [];
let _categories: TestCategory[] = TEST_CATEGORIES;
type CatalogStatus = "idle" | "loading" | "ready" | "error";
let _status: CatalogStatus = "idle";
let _hydrated = false;
let _remoteHydrated = false;

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  hydrateFromSupabase();
}

async function hydrateFromSupabase() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  if (!USE_SUPABASE || !supabaseEnvReady()) return;
  const sb = getSupabaseBrowser();
  if (!sb) return;
  _status = "loading";
  emit();
  try {
    const [t, p, c] = await Promise.all([
      fetchTests(sb),
      fetchPackages(sb),
      fetchCategories(sb),
    ]);
    if (t) _tests = t;
    if (c) _categories = c;
    if (p && t) {
      const lookup = new Map(t.map((x) => [x.id, x]));
      _packages = p.packages.map((pkg) => ({
        ...pkg,
        tests: (p.itemsByPackage.get(pkg.id) ?? [])
          .map((id) => lookup.get(id))
          .filter((x): x is Test => Boolean(x)),
      }));
    }
    _status = "ready";
    emit();
  } catch (err) {
    console.warn("[supabase] catalog hydrate failed", err);
    _status = "error";
    emit();
  }
}

// Force a re-fetch of the customer catalog (e.g. pull-to-refresh on home).
export async function refreshCatalog(): Promise<void> {
  _remoteHydrated = false;
  await hydrateFromSupabase();
}

export function getTests(): Test[] { if (!_hydrated) hydrate(); return _tests; }
export function getPackages(): Package[] { if (!_hydrated) hydrate(); return _packages; }
export function getCategories(): TestCategory[] { if (!_hydrated) hydrate(); return _categories; }
export function getCatalogStatus(): CatalogStatus { return _status; }

export function useTests(): Test[] {
  return useSyncExternalStore(subscribe, getTests, () => []);
}
export function usePackages(): Package[] {
  return useSyncExternalStore(subscribe, getPackages, () => []);
}
export function useCategories(): TestCategory[] {
  return useSyncExternalStore(subscribe, getCategories, () => TEST_CATEGORIES);
}
export function useCatalogStatus(): CatalogStatus {
  return useSyncExternalStore(subscribe, getCatalogStatus, () => "idle");
}
