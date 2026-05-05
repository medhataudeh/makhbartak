"use client";
import { useSyncExternalStore } from "react";
import type { AuthSession, PaymentMethod } from "./types";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import { apiSetPaymentPreference } from "./customer-api";

// Phase 3 production hardening: customers.preferred_payment_method is the
// only source of truth. hydrateProfileForCustomer (lib/profile.ts) calls
// setHydratedPreferredPayment with the canonical value at startup; every
// in-app change flows through setPreferredPayment which writes to the
// API first and then mirrors locally on success.
//
// localStorage is allowed only as a read-through UX cache so the cart
// pre-selects yesterday's choice during the round-trip. The cache is
// rewritten on every API confirmation; it is never read as a fallback
// when the API call fails.

const CACHE_KEY = "makhbartak.payment.preferred";

let _pref: PaymentMethod | null = null;
let _hydrated = false;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function ensureHydrated() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  // Optional first-paint cache only. The canonical value lands via
  // setHydratedPreferredPayment from hydrateProfileForCustomer.
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw === "cash" || raw === "online") _pref = raw;
  } catch {}
  emit();
}

function writeCache(p: PaymentMethod | null) {
  if (typeof window === "undefined") return;
  try {
    if (p) window.localStorage.setItem(CACHE_KEY, p);
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {}
}

// Called by hydrateProfileForCustomer once the canonical value lands.
export function setHydratedPreferredPayment(p: PaymentMethod | null) {
  _pref = p;
  writeCache(p);
  emit();
}

export function getPreferredPayment(): PaymentMethod | null {
  if (!_hydrated) ensureHydrated();
  return _pref;
}

export async function setPreferredPayment(p: PaymentMethod): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) {
    _pref = p;
    writeCache(p);
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
  writeCache(p);
  emit();
  return { ok: true };
}

export function usePreferredPayment() {
  return useSyncExternalStore(subscribe, getPreferredPayment, () => null);
}
