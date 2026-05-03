"use client";
import { useSyncExternalStore } from "react";
import type { SystemSettings } from "./types";
import { SYSTEM_SETTINGS } from "./mock-data";
import { USE_SUPABASE, supabaseEnvReady } from "./supabase/flags";
import { getSupabaseBrowser } from "./supabase/client";
import { fetchAppSettings } from "./supabase/queries/app-settings";

const KEY = "makhbartak.system-settings.v1";

let _s: SystemSettings = { ...SYSTEM_SETTINGS };
let _hydrated = false;
let _remoteHydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) _s = { ...SYSTEM_SETTINGS, ...(JSON.parse(raw) as Partial<SystemSettings>) };
  } catch {}
  emit();
  hydrateFromSupabase();
}

async function hydrateFromSupabase() {
  if (_remoteHydrated) return;
  _remoteHydrated = true;
  if (!USE_SUPABASE || !supabaseEnvReady()) return;
  const sb = getSupabaseBrowser();
  if (!sb) return;
  try {
    const remote = await fetchAppSettings(sb);
    if (remote) {
      _s = { ..._s, ...remote };
      emit();
    }
  } catch (err) {
    console.warn("[supabase] app_settings hydrate failed; using local", err);
  }
}

export function getSystemSettings(): SystemSettings {
  if (!_hydrated) hydrate();
  return _s;
}

export function updateSystemSettings(patch: Partial<SystemSettings>): Promise<{ ok: boolean; error?: string }> {
  _s = { ...getSystemSettings(), ...patch };
  try { window.localStorage.setItem(KEY, JSON.stringify(_s)); } catch {}
  emit();
  return persistSystemSettingsViaApi(patch);
}

async function persistSystemSettingsViaApi(
  patch: Partial<SystemSettings>,
): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return { ok: true };
  // Map camelCase TS keys to the snake_case columns the RPC accepts.
  const wire: Record<string, unknown> = {};
  if (patch.minBookingNoticeMinutes != null) wire.min_booking_notice_minutes = patch.minBookingNoticeMinutes;
  if (patch.morningShiftStart != null) wire.morning_shift_start = patch.morningShiftStart;
  if (patch.morningShiftEnd != null) wire.morning_shift_end = patch.morningShiftEnd;
  if (patch.eveningShiftStart != null) wire.evening_shift_start = patch.eveningShiftStart;
  if (patch.eveningShiftEnd != null) wire.evening_shift_end = patch.eveningShiftEnd;
  if (patch.supportedCities != null) wire.supported_cities = patch.supportedCities;
  if (patch.whatsappNumber != null) wire.whatsapp_number = patch.whatsappNumber;
  if (patch.allowCashOrders != null) wire.allow_cash_orders = patch.allowCashOrders;
  if (patch.bookingWindowDays != null) wire.booking_horizon_days = patch.bookingWindowDays;
  if (patch.maxOrdersPerShift != null) wire.max_orders_per_shift = patch.maxOrdersPerShift;
  const res = await fetch("/api/admin/app-settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, patch: wire }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export function useSystemSettings(): SystemSettings {
  return useSyncExternalStore(subscribe, getSystemSettings, () => SYSTEM_SETTINGS);
}
