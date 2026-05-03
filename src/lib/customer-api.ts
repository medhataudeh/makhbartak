"use client";
import type { Address, Patient } from "@/lib/types";

interface RawPatient {
  id: string; customer_id: string; name: string;
  national_id: string | null; note: string | null; is_default: boolean;
}
interface RawAddress {
  id: string; customer_id: string; label: string; description: string;
  city: string; area: string | null; lat: number | null; lng: number | null;
  is_default: boolean;
}

export interface CustomerProfileSnapshot {
  patients: Patient[];
  addresses: Address[];
  paymentPreference: "cash" | "online" | null;
  defaultPatientId: string | null;
  defaultAddressId: string | null;
}

function mapPatient(r: RawPatient): Patient {
  return {
    id: r.id,
    userId: r.customer_id,
    name: r.name,
    nationalId: r.national_id ?? undefined,
    note: r.note ?? undefined,
    isDefault: r.is_default,
  };
}

function mapAddress(r: RawAddress): Address {
  return {
    id: r.id,
    userId: r.customer_id,
    label: r.label,
    description: r.description,
    city: r.city,
    lat: r.lat == null ? 0 : Number(r.lat),
    lng: r.lng == null ? 0 : Number(r.lng),
    isDefault: r.is_default,
  };
}

export async function apiGetCustomerProfile(customerId: string): Promise<CustomerProfileSnapshot | null> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/profile`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  return {
    patients: ((body.patients ?? []) as RawPatient[]).map(mapPatient),
    addresses: ((body.addresses ?? []) as RawAddress[]).map(mapAddress),
    paymentPreference: body.paymentPreference ?? null,
    defaultPatientId: body.defaultPatientId ?? null,
    defaultAddressId: body.defaultAddressId ?? null,
  };
}

export interface PatientPatch {
  name: string;
  nationalId?: string;
  note?: string;
  isDefault?: boolean;
}

export async function apiCreatePatient(
  customerId: string,
  patch: PatientPatch,
): Promise<{ patient: Patient } | { error: string }> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/patients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { patient: mapPatient(body.patient) };
}

export async function apiUpdatePatient(
  customerId: string,
  patientId: string,
  patch: Partial<PatientPatch>,
): Promise<{ patient: Patient } | { error: string }> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/patients/${encodeURIComponent(patientId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { patient: mapPatient(body.patient) };
}

export async function apiDeletePatient(
  customerId: string,
  patientId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/patients/${encodeURIComponent(patientId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export interface AddressPatch {
  label: string;
  description: string;
  city: string;
  area?: string;
  lat?: number | null;
  lng?: number | null;
  isDefault?: boolean;
}

export async function apiCreateAddress(
  customerId: string,
  patch: AddressPatch,
): Promise<{ address: Address } | { error: string }> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/addresses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { address: mapAddress(body.address) };
}

export async function apiUpdateAddress(
  customerId: string,
  addressId: string,
  patch: Partial<AddressPatch>,
): Promise<{ address: Address } | { error: string }> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/addresses/${encodeURIComponent(addressId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { address: mapAddress(body.address) };
}

export async function apiDeleteAddress(
  customerId: string,
  addressId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/addresses/${encodeURIComponent(addressId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function apiSetPaymentPreference(
  customerId: string,
  method: "cash" | "online",
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/payment-preference`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}
