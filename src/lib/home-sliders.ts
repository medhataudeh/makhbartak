"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { SliderItem } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { hydrateAdminSliders } from "./admin-catalog-api";

// Customer-facing slider list. The home hero is now strictly DB-driven via
// /api/admin/sliders GET. If the admin hasn't seeded the table the hero
// renders empty (HomeScreen handles this gracefully) — that's the signal
// for the operator to add a slider in the admin dashboard. No mock
// fallback so production never silently shows demo content.
let _sliders: SliderItem[] = [];
let _hydratedOnce = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function getSliders(): SliderItem[] { return _sliders; }

async function fetchSliders(): Promise<void> {
  if (!USE_SUPABASE) return;
  const remote = await hydrateAdminSliders();
  if (!remote) return;
  _sliders = remote.filter((s) => s.isActive);
  emit();
}

export function useSliders(): SliderItem[] {
  useEffect(() => {
    if (_hydratedOnce) return;
    _hydratedOnce = true;
    void fetchSliders();
  }, []);
  return useSyncExternalStore(subscribe, getSliders, () => []);
}

// Force a re-fetch (e.g. pull-to-refresh on the customer home).
export async function refreshSliders(): Promise<void> {
  _hydratedOnce = true;
  await fetchSliders();
}
