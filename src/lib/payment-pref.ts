"use client";
import { useSyncExternalStore } from "react";
import type { PaymentMethod } from "./types";

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

export function getPreferredPayment(): PaymentMethod | null {
  if (!_hydrated) hydrate();
  return _pref;
}

export function setPreferredPayment(p: PaymentMethod) {
  _pref = p;
  try { window.localStorage.setItem(KEY, p); } catch {}
  emit();
}

export function usePreferredPayment() {
  return useSyncExternalStore(subscribe, getPreferredPayment, () => null);
}
