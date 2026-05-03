"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { SliderItem } from "./types";
import { MOCK_SLIDERS } from "./mock-data";
import { USE_SUPABASE } from "./supabase/flags";
import { hydrateAdminSliders } from "./admin-catalog-api";

// Customer-facing slider list. Hydrates from Supabase via the existing
// /api/admin/sliders GET (the GET handler has no admin gate; only the
// POST/DELETE require an admin session). MOCK_SLIDERS seeds the first paint
// for flag-off mock mode and during the network round-trip.
let _sliders: SliderItem[] = [...MOCK_SLIDERS];
let _hydratedOnce = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function getSliders(): SliderItem[] { return _sliders; }

export function useSliders(): SliderItem[] {
  // Trigger a single hydrate when the consumer first mounts. Subsequent
  // mounts re-use the cached _sliders. Admin edits land via apiUpsertSlider;
  // a customer refresh re-runs hydrate.
  useEffect(() => {
    if (_hydratedOnce) return;
    _hydratedOnce = true;
    if (!USE_SUPABASE) return;
    void (async () => {
      const remote = await hydrateAdminSliders();
      if (remote) {
        _sliders = remote;
        emit();
      }
    })();
  }, []);
  return useSyncExternalStore(subscribe, getSliders, () => MOCK_SLIDERS);
}
