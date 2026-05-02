"use client";
import { useSyncExternalStore } from "react";
import type { PaymentMethod } from "./types";
import { USE_SUPABASE, supabaseEnvReady } from "./supabase/flags";
import { getSupabaseBrowser } from "./supabase/client";
import { getCurrentCustomerId } from "./supabase/auth-helpers";
import { fetchPaymentPref, setPaymentPrefRemote } from "./supabase/queries/profile";

const KEY = "makhbartak.payment.preferred";

let _pref: PaymentMethod | null = null;
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
    if (raw === "cash" || raw === "online") _pref = raw;
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
    const customerId = await getCurrentCustomerId(sb);
    if (!customerId) return;
    const remote = await fetchPaymentPref(sb, customerId);
    if (remote) {
      _pref = remote;
      emit();
    }
  } catch (err) {
    console.warn("[supabase] payment-pref hydrate failed; using local", err);
  }
}

export function getPreferredPayment(): PaymentMethod | null {
  if (!_hydrated) hydrate();
  return _pref;
}

export function setPreferredPayment(p: PaymentMethod) {
  _pref = p;
  try { window.localStorage.setItem(KEY, p); } catch {}
  emit();
  void writePaymentPrefRemote(p);
}

async function writePaymentPrefRemote(p: PaymentMethod): Promise<void> {
  if (!USE_SUPABASE || !supabaseEnvReady()) return;
  const sb = getSupabaseBrowser();
  if (!sb) return;
  const customerId = await getCurrentCustomerId(sb);
  if (!customerId) return;
  const res = await setPaymentPrefRemote(sb, customerId, p);
  if (!res.ok) console.warn("[supabase] setPaymentPref failed", res.error);
}

export function usePreferredPayment() {
  return useSyncExternalStore(subscribe, getPreferredPayment, () => null);
}
