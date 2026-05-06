"use client";
import { useSyncExternalStore } from "react";
import type { AdminSystemSettings } from "./types";
import { SYSTEM_SETTINGS } from "./mock-data";

// Phase B of the public/private settings split.
//
// This store is the admin counterpart to the public `system-settings.ts`
// store. It hydrates from the cap-gated /api/admin/system/settings GET so
// the admin UI can read finance-sensitive fields (nurseCommissionPercentage)
// without leaking them through the public route.
//
// FALLBACK CONTRACT
// ─────────────────
// Per the Phase B spec, silent fallback to mock-data defaults is only
// acceptable when the API failure cannot in itself indicate a permission
// regression:
//
//   * 401 (unauthenticated)         → status="fallback"
//                                      Acceptable: caller has no session yet;
//                                      this commonly fires on the first paint
//                                      before the auth cookie is read.
//   * 5xx / network failure         → status="fallback"
//                                      Acceptable: the server is unreachable;
//                                      the alternative is a blank page.
//   * 403 (admin lacks the cap, or
//          non-admin auth user)     → status="forbidden"
//                                      NOT a silent fallback. Settings stays
//                                      null so the UI is forced to render an
//                                      explicit degraded/read-only state.
//                                      This intentionally surfaces RBAC bugs
//                                      instead of masking them with mock data.
//   * 200 with body                 → status="ok"
//                                      Settings is canonical.
//   * 200 with null body            → status="fallback"
//                                      The DB row is missing — extremely rare
//                                      but the UI still needs something to
//                                      render.
//
// The store is hand-rolled to match the `subscribe + emit` shape used
// elsewhere (consistent with `system-settings.ts`).

export type AdminSystemSettingsStatus =
  | "loading"
  | "ok"
  | "forbidden"
  | "fallback";

export interface AdminSystemSettingsState {
  status: AdminSystemSettingsStatus;
  /** Populated when status is "ok" or "fallback". Null when "forbidden" or
   *  "loading" before the first fetch resolves. The UI MUST guard on status
   *  before rendering when this can be null. */
  settings: AdminSystemSettings | null;
}

const INITIAL: AdminSystemSettingsState = { status: "loading", settings: null };

let _state: AdminSystemSettingsState = INITIAL;
let _hydrated = false;
let _remoteHydrated = false;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function setState(next: AdminSystemSettingsState) {
  _state = next;
  emit();
}

function ensureHydrated() {
  if (_hydrated) return;
  _hydrated = true;
  void hydrateFromApi();
}

async function hydrateFromApi() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  try {
    const res = await fetch("/api/admin/system/settings", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (res.status === 401) {
      // Unauthenticated — common during first paint before the auth cookie
      // resolves. Quietly fall back so the screen renders something.
      setState({ status: "fallback", settings: SYSTEM_SETTINGS });
      return;
    }
    if (res.status === 403) {
      // Authenticated but lacks system.app_settings.read (or is not an
      // admin at all). Do NOT silently fall back — the admin UI must
      // surface this state intentionally.
      setState({ status: "forbidden", settings: null });
      return;
    }
    if (!res.ok) {
      // 5xx or other non-2xx: treat as transient network failure.
      setState({ status: "fallback", settings: SYSTEM_SETTINGS });
      return;
    }

    const body = await res.json().catch(() => null);
    const remote = body?.settings as AdminSystemSettings | null | undefined;
    if (!remote) {
      // Singleton row missing or shape mismatch — degrade rather than crash.
      setState({ status: "fallback", settings: SYSTEM_SETTINGS });
      return;
    }
    setState({ status: "ok", settings: remote });
  } catch {
    // Network exception — silent fallback per contract.
    setState({ status: "fallback", settings: SYSTEM_SETTINGS });
  }
}

/**
 * Force a refetch on the next subscribe / read. Useful after a successful
 * PATCH so the admin UI can reflect the canonical post-write values without
 * a full reload. Phase D will wire this into the SettingsAdmin save path.
 */
export function invalidateAdminSystemSettings() {
  _hydrated = false;
  _remoteHydrated = false;
  setState(INITIAL);
}

export function getAdminSystemSettings(): AdminSystemSettingsState {
  if (!_hydrated) ensureHydrated();
  return _state;
}

export function useAdminSystemSettings(): AdminSystemSettingsState {
  return useSyncExternalStore(
    subscribe,
    getAdminSystemSettings,
    () => INITIAL,
  );
}
