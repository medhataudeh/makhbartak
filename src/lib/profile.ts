"use client";
import { useSyncExternalStore } from "react";
import type { Patient, Address } from "./types";
import { MOCK_PATIENTS, MOCK_ADDRESSES } from "./mock-data";

const PATIENTS_KEY  = "makhbartak.profile.patients.v1";
const ADDRESSES_KEY = "makhbartak.profile.addresses.v1";

let _patients: Patient[]   = [...MOCK_PATIENTS];
let _addresses: Address[]  = [...MOCK_ADDRESSES];
let _hydrated = false;

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

// ─── Patients ──────────────────────────────────────────────────────────────
export function getPatients(): Patient[] {
  if (!_hydrated) hydrate();
  return _patients;
}
export function usePatients(): Patient[] {
  return useSyncExternalStore(subscribe, getPatients, () => MOCK_PATIENTS);
}
export function upsertPatient(p: Patient): void {
  // Defaulting is exclusive: setting a default unsets others.
  let next = getPatients();
  const exists = next.find((x) => x.id === p.id);
  next = exists ? next.map((x) => x.id === p.id ? p : x) : [...next, p];
  if (p.isDefault) next = next.map((x) => x.id === p.id ? x : { ...x, isDefault: false });
  _patients = next;
  persistPatients();
  emit();
}
export function deletePatient(id: string): void {
  _patients = getPatients().filter((p) => p.id !== id);
  // Promote the first remaining patient to default if none are.
  if (_patients.length && !_patients.some((p) => p.isDefault)) {
    _patients = _patients.map((p, i) => i === 0 ? { ...p, isDefault: true } : p);
  }
  persistPatients();
  emit();
}

// ─── Addresses ─────────────────────────────────────────────────────────────
export function getAddresses(): Address[] {
  if (!_hydrated) hydrate();
  return _addresses;
}
export function useAddresses(): Address[] {
  return useSyncExternalStore(subscribe, getAddresses, () => MOCK_ADDRESSES);
}
export function upsertAddress(a: Address): void {
  let next = getAddresses();
  const exists = next.find((x) => x.id === a.id);
  next = exists ? next.map((x) => x.id === a.id ? a : x) : [...next, a];
  if (a.isDefault) next = next.map((x) => x.id === a.id ? x : { ...x, isDefault: false });
  _addresses = next;
  persistAddresses();
  emit();
}
export function deleteAddress(id: string): void {
  _addresses = getAddresses().filter((a) => a.id !== id);
  if (_addresses.length && !_addresses.some((a) => a.isDefault)) {
    _addresses = _addresses.map((a, i) => i === 0 ? { ...a, isDefault: true } : a);
  }
  persistAddresses();
  emit();
}
