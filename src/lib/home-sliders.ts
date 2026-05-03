"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { SliderItem } from "./types";
import { MOCK_SLIDERS } from "./mock-data";
import { USE_SUPABASE } from "./supabase/flags";
import { hydrateAdminSliders } from "./admin-catalog-api";

// Customer-facing slider list. Hydrates from Supabase via /api/admin/sliders
// GET (no admin gate on GET — only POST/DELETE). Mock sliders seed the first
// paint and act as the offline/empty fallback so the home hero never
// disappears just because the DB has no rows yet.
const MOCK_ACTIVE = MOCK_SLIDERS.filter((s) => s.isActive);
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
      if (!remote) return;
      // If the admin DB has no sliders (or none active), keep the mock
      // fallback visible — an empty home hero is worse than a default one,
      // and admins can replace it any time.
      const activeRemote = remote.filter((s) => s.isActive);
      _sliders = activeRemote.length > 0 ? remote : MOCK_ACTIVE;
      emit();
    })();
  }, []);
  return useSyncExternalStore(subscribe, getSliders, () => MOCK_SLIDERS);
}
