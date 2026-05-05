"use client";
import { useSyncExternalStore } from "react";
import type { AuthSession, PaymentMethod } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import { apiSetPaymentPreference } from "./customer-api";

// STORAGE POLICY (Phase 4 cleanup):
//   * SOURCE OF TRUTH: public.customers.preferred_payment_method.
//   * hydrateProfileForCustomer (lib/profile.ts) loads the canonical value
//     at session startup; setPreferredPayment writes to the API first and
//     mirrors locally only after the server confirms.
//   * No localStorage. The cart pre-selects from the in-memory hydrate;
//     a fresh tab waits for hydrateProfileForCustomer to land.

let _pref: PaymentMethod | null = null;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

// Called by hydrateProfileForCustomer once the canonical value lands.
export function setHydratedPreferredPayment(p: PaymentMethod | null) {
  _pref = p;
  emit();
}

export function getPreferredPayment(): PaymentMethod | null { return _pref; }

export async function setPreferredPayment(p: PaymentMethod): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) {
    _pref = p;
    emit();
    return { ok: true };
  }
  const session: AuthSession | null = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "customer" || !isUuid(session.linkedEntityId)) {
    return { ok: false, error: "session not authenticated" };
  }
  const r = await apiSetPaymentPreference(session.linkedEntityId, p);
  if (!r.ok) return r;
  // Mirror locally only after the server confirms — DB is the source of truth.
  _pref = p;
  emit();
  return { ok: true };
}

export function usePreferredPayment() {
  return useSyncExternalStore(subscribe, getPreferredPayment, () => null);
}
