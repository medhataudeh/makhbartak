"use client";
import { useSyncExternalStore } from "react";
import type { Address, AuthSession, Patient } from "./types";
import { MOCK_PATIENTS, MOCK_ADDRESSES } from "./mock-data";
import { USE_SUPABASE } from "./supabase/flags";
import { isUuid } from "./supabase/uuid";
import {
  apiCreatePatient, apiUpdatePatient, apiDeletePatient,
  apiCreateAddress, apiUpdateAddress, apiDeleteAddress,
  apiGetCustomerProfile,
} from "./customer-api";
import { setHydratedPreferredPayment } from "./payment-pref";

// Stage E: Supabase is the source of truth for patients + addresses.
// localStorage stays as a write-through cache + offline preview only.
//
// The shape of the public API is unchanged for legacy callers (usePatients,
// useAddresses, upsertPatient, etc.) but the upserts now return Promises that
// resolve to the canonical row whose `id` is a real Supabase UUID. Booking
// and order placement gate on that uuid before calling /api/orders.
const PATIENTS_KEY  = "makhbartak.profile.patients.v1";
const ADDRESSES_KEY = "makhbartak.profile.addresses.v1";

let _patients: Patient[]   = [...MOCK_PATIENTS];
let _addresses: Address[]  = [...MOCK_ADDRESSES];
let _hydrated = false;
let _hydratedCustomerId: string | null = null;

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function hydrate() {
  if (_hydrated || typeof window === "undefined") return;
  _hydrated = true;
  try {
    const p = window.localStorage.getItem(PATIENTS_KEY);
    if (p) _patients = JSON.parse(p) as Patient[];
    const a = window.localStorage.getItem(ADDRESSES_KEY);
    if (a) _addresses = JSON.parse(a) as Address[];
  } catch {}
  emit();
}

function persistPatients() {
  try { window.localStorage.setItem(PATIENTS_KEY, JSON.stringify(_patients)); } catch {}
}
function persistAddresses() {
  try { window.localStorage.setItem(ADDRESSES_KEY, JSON.stringify(_addresses)); } catch {}
}

// Public hydration helper — call from the customer app on mount or session
// change. Replaces the local arrays with canonical Supabase rows so order
// placement always sees real UUIDs.
export async function hydrateProfileForCustomer(customerId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  if (!isUuid(customerId)) return;
  if (_hydratedCustomerId === customerId) return;
  const snap = await apiGetCustomerProfile(customerId);
  if (!snap) return;
  _patients = snap.patients;
  _addresses = snap.addresses;
  _hydratedCustomerId = customerId;
  persistPatients();
  persistAddresses();
  setHydratedPreferredPayment(snap.paymentPreference);
  emit();
}

async function getSession(): Promise<AuthSession | null> {
  return (await import("./auth")).getStoredSession();
}

// ─── Patients ──────────────────────────────────────────────────────────────
export function getPatients(): Patient[] {
  if (!_hydrated) hydrate();
  return _patients;
}
export function usePatients(): Patient[] {
  return useSyncExternalStore(subscribe, getPatients, () => MOCK_PATIENTS);
}

/**
 * Upsert a patient. Returns the canonical row (with a real Supabase UUID
 * when flag-on). The booking flow awaits this before allowing the customer
 * to continue past the patient picker.
 */
export async function upsertPatient(p: Patient): Promise<{ ok: boolean; patient?: Patient; error?: string }> {
  if (!_hydrated) hydrate();
  // Optimistic local merge so the picker reflects immediately.
  applyLocalUpsertPatient(p);
  emit();

  if (!USE_SUPABASE) return { ok: true, patient: p };
  const session = await getSession();
  if (!session || session.role !== "customer" || !isUuid(session.linkedEntityId)) {
    return { ok: true, patient: p };
  }

  const isUpdate = isUuid(p.id) && _patients.some((x) => x.id === p.id);
  const result = isUpdate
    ? await apiUpdatePatient(session.linkedEntityId, p.id, {
        name: p.name, nationalId: p.nationalId, note: p.note, isDefault: p.isDefault,
      })
    : await apiCreatePatient(session.linkedEntityId, {
        name: p.name, nationalId: p.nationalId, note: p.note, isDefault: p.isDefault,
      });
  if ("error" in result) {
    // Roll back the placeholder so the picker doesn't keep a non-uuid row
    // that would later poison /api/orders. Update path leaves the row in
    // place because the id was already canonical.
    if (!isUpdate) {
      _patients = _patients.filter((x) => x.id !== p.id);
      persistPatients();
      emit();
    }
    console.warn("[customer-api] upsertPatient failed", result.error);
    return { ok: false, error: result.error };
  }
  // Replace the placeholder row with the canonical one (id may differ).
  const canonical = result.patient;
  _patients = _patients
    .filter((x) => x.id !== p.id)
    .filter((x) => x.id !== canonical.id)
    .concat([canonical])
    .map((x) => canonical.isDefault && x.id !== canonical.id ? { ...x, isDefault: false } : x);
  persistPatients();
  emit();
  return { ok: true, patient: canonical };
}

function applyLocalUpsertPatient(p: Patient) {
  const exists = _patients.find((x) => x.id === p.id);
  let next = exists ? _patients.map((x) => x.id === p.id ? p : x) : [..._patients, p];
  if (p.isDefault) next = next.map((x) => x.id === p.id ? x : { ...x, isDefault: false });
  _patients = next;
  persistPatients();
}

export async function deletePatient(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!_hydrated) hydrate();
  _patients = _patients.filter((p) => p.id !== id);
  if (_patients.length && !_patients.some((p) => p.isDefault)) {
    _patients = _patients.map((p, i) => i === 0 ? { ...p, isDefault: true } : p);
  }
  persistPatients();
  emit();
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(id)) return { ok: true };
  const session = await getSession();
  if (!session || session.role !== "customer" || !isUuid(session.linkedEntityId)) return { ok: true };
  return apiDeletePatient(session.linkedEntityId, id);
}

// ─── Addresses ─────────────────────────────────────────────────────────────
export function getAddresses(): Address[] {
  if (!_hydrated) hydrate();
  return _addresses;
}
export function useAddresses(): Address[] {
  return useSyncExternalStore(subscribe, getAddresses, () => MOCK_ADDRESSES);
}

export async function upsertAddress(a: Address): Promise<{ ok: boolean; address?: Address; error?: string }> {
  if (!_hydrated) hydrate();
  applyLocalUpsertAddress(a);
  emit();

  if (!USE_SUPABASE) return { ok: true, address: a };
  const session = await getSession();
  if (!session || session.role !== "customer" || !isUuid(session.linkedEntityId)) {
    return { ok: true, address: a };
  }

  const isUpdate = isUuid(a.id) && _addresses.some((x) => x.id === a.id);
  const result = isUpdate
    ? await apiUpdateAddress(session.linkedEntityId, a.id, {
        label: a.label, description: a.description, city: a.city,
        lat: a.lat || null, lng: a.lng || null, isDefault: a.isDefault,
      })
    : await apiCreateAddress(session.linkedEntityId, {
        label: a.label, description: a.description, city: a.city,
        lat: a.lat || null, lng: a.lng || null, isDefault: a.isDefault,
      });
  if ("error" in result) {
    if (!isUpdate) {
      _addresses = _addresses.filter((x) => x.id !== a.id);
      persistAddresses();
      emit();
    }
    console.warn("[customer-api] upsertAddress failed", result.error);
    return { ok: false, error: result.error };
  }
  const canonical = result.address;
  _addresses = _addresses
    .filter((x) => x.id !== a.id)
    .filter((x) => x.id !== canonical.id)
    .concat([canonical])
    .map((x) => canonical.isDefault && x.id !== canonical.id ? { ...x, isDefault: false } : x);
  persistAddresses();
  emit();
  return { ok: true, address: canonical };
}

function applyLocalUpsertAddress(a: Address) {
  const exists = _addresses.find((x) => x.id === a.id);
  let next = exists ? _addresses.map((x) => x.id === a.id ? a : x) : [..._addresses, a];
  if (a.isDefault) next = next.map((x) => x.id === a.id ? x : { ...x, isDefault: false });
  _addresses = next;
  persistAddresses();
}

export async function deleteAddress(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!_hydrated) hydrate();
  _addresses = _addresses.filter((a) => a.id !== id);
  if (_addresses.length && !_addresses.some((a) => a.isDefault)) {
    _addresses = _addresses.map((a, i) => i === 0 ? { ...a, isDefault: true } : a);
  }
  persistAddresses();
  emit();
  if (!USE_SUPABASE) return { ok: true };
  if (!isUuid(id)) return { ok: true };
  const session = await getSession();
  if (!session || session.role !== "customer" || !isUuid(session.linkedEntityId)) return { ok: true };
  return apiDeleteAddress(session.linkedEntityId, id);
}
