"use client";
import { useSyncExternalStore } from "react";
import type { AuthSession, PaymentMethod } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import { apiSetPaymentPreference } from "./customer-api";

// Stage E: Supabase is the source of truth (customers.preferred_payment_method).
// localStorage stays as a write-through cache for the first paint.
const KEY = "makhbartak.payment.preferred";

let _pref: PaymentMethod | null = null;
let _hydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === "cash" || raw === "online") _pref = raw;
  } catch {}
  emit();
}

// Public hydration helper. Caller passes the Supabase customer UUID.
// hydrateProfileForCustomer in lib/profile.ts already pulls the same field
// alongside patients/addresses; this function is exposed for direct use too.
export function setHydratedPreferredPayment(p: PaymentMethod | null) {
  _pref = p;
  try {
    if (p) window.localStorage.setItem(KEY, p);
    else window.localStorage.removeItem(KEY);
  } catch {}
  emit();
}

export function getPreferredPayment(): PaymentMethod | null {
  if (!_hydrated) hydrate();
  return _pref;
}

export async function setPreferredPayment(p: PaymentMethod): Promise<{ ok: boolean; error?: string }> {
  _pref = p;
  try { window.localStorage.setItem(KEY, p); } catch {}
  emit();
  if (!USE_SUPABASE) return { ok: true };
  const session: AuthSession | null = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "customer" || !isUuid(session.linkedEntityId)) return { ok: true };
  return apiSetPaymentPreference(session.linkedEntityId, p);
}

export function usePreferredPayment() {
  return useSyncExternalStore(subscribe, getPreferredPayment, () => null);
}
