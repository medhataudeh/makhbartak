"use client";
import { useSyncExternalStore } from "react";
import type { Test, Package, TestCategory } from "./types";
import { MOCK_TESTS, MOCK_PACKAGES, TEST_CATEGORIES } from "./mock-data";
import { USE_SUPABASE, supabaseEnvReady } from "./supabase/flags";
import { getSupabaseBrowser } from "./supabase/client";
import {
  fetchTests,
  fetchPackages,
  fetchCategories,
} from "./supabase/queries/catalog";

let _tests: Test[] = MOCK_TESTS;
let _packages: Package[] = MOCK_PACKAGES;
let _categories: TestCategory[] = TEST_CATEGORIES;
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
  try {
    const [t, p, c] = await Promise.all([
      fetchTests(sb),
      fetchPackages(sb),
      fetchCategories(sb),
    ]);
    let changed = false;
    if (t) { _tests = t; changed = true; }
    if (c) { _categories = c; changed = true; }
    if (p) {
      // Resolve package_items → Test[] by lookup against the freshly fetched
      // (or fallback) test list. Falls back to MOCK_TESTS if remote tests
      // are unavailable so package cards never render empty.
      const lookup = new Map((t ?? MOCK_TESTS).map((x) => [x.id, x]));
      _packages = p.packages.map((pkg) => ({
        ...pkg,
        tests: (p.itemsByPackage.get(pkg.id) ?? [])
          .map((id) => lookup.get(id))
          .filter((x): x is Test => Boolean(x)),
      }));
      changed = true;
    }
    if (changed) emit();
  } catch (err) {
    console.warn("[supabase] catalog hydrate failed; using local", err);
  }
}

export function getTests(): Test[] { if (!_hydrated) hydrate(); return _tests; }
export function getPackages(): Package[] { if (!_hydrated) hydrate(); return _packages; }
export function getCategories(): TestCategory[] { if (!_hydrated) hydrate(); return _categories; }

export function useTests(): Test[] {
  return useSyncExternalStore(subscribe, getTests, () => MOCK_TESTS);
}
export function usePackages(): Package[] {
  return useSyncExternalStore(subscribe, getPackages, () => MOCK_PACKAGES);
}
export function useCategories(): TestCategory[] {
  return useSyncExternalStore(subscribe, getCategories, () => TEST_CATEGORIES);
}
