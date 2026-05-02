import type { SupabaseClient } from "@supabase/supabase-js";
import type { Patient, Address, PaymentMethod } from "@/lib/types";
import { isUuid } from "@/lib/supabase/uuid";

// All read/write helpers below assume a customer_id has already been resolved
// for the signed-in user. They return null on error so the caller can fall
// back to the legacy local store.

export async function fetchPatients(
  sb: SupabaseClient,
  customerId: string
): Promise<Patient[] | null> {
  if (!isUuid(customerId)) return null;
  const { data, error } = await sb
    .from("patients")
    .select("id, customer_id, name, national_id, note, is_default")
    .eq("customer_id", customerId)
    .is("deleted_at", null);
  if (error || !data) return null;
  return data.map((r) => ({
    id: r.id,
    userId: r.customer_id,
    name: r.name,
    nationalId: r.national_id ?? undefined,
    note: r.note ?? undefined,
    isDefault: r.is_default,
  }));
}

export async function fetchAddresses(
  sb: SupabaseClient,
  customerId: string
): Promise<Address[] | null> {
  if (!isUuid(customerId)) return null;
  const { data, error } = await sb
    .from("addresses")
    .select("id, customer_id, label, description, city, lat, lng, is_default")
    .eq("customer_id", customerId)
    .is("deleted_at", null);
  if (error || !data) return null;
  return data.map((r) => ({
    id: r.id,
    userId: r.customer_id,
    label: r.label,
    description: r.description,
    city: r.city,
    lat: r.lat == null ? 0 : Number(r.lat),
    lng: r.lng == null ? 0 : Number(r.lng),
    isDefault: r.is_default,
  }));
}

export async function fetchPaymentPref(
  sb: SupabaseClient,
  customerId: string
): Promise<PaymentMethod | null> {
  if (!isUuid(customerId)) return null;
  const { data, error } = await sb
    .from("customers")
    .select("preferred_payment_method")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !data) return null;
  const v = data.preferred_payment_method;
  return v === "cash" || v === "online" ? (v as PaymentMethod) : null;
}

// ─── Mutations ─────────────────────────────────────────────────────────────
// All mutations return { ok, error? } so callers can toast on failure and
// roll back optimistic local state.

export interface MutationResult {
  ok: boolean;
  error?: string;
  /** When the row was inserted, the server-assigned id (uuid). */
  id?: string;
}

export async function upsertPatientRemote(
  sb: SupabaseClient,
  customerId: string,
  p: Patient
): Promise<MutationResult> {
  if (!isUuid(customerId) || !isUuid(p.id)) {
    return { ok: false, error: "invalid uuid (skipped)" };
  }
  // Defaulting is exclusive: when isDefault is true, clear other defaults
  // first so RLS-friendly partial unique constraints (if any) hold.
  if (p.isDefault) {
    await sb
      .from("patients")
      .update({ is_default: false })
      .eq("customer_id", customerId)
      .neq("id", p.id);
  }
  const row = {
    id: p.id,
    customer_id: customerId,
    name: p.name,
    national_id: p.nationalId ?? null,
    note: p.note ?? null,
    is_default: p.isDefault,
  };
  const { error } = await sb.from("patients").upsert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: p.id };
}

export async function deletePatientRemote(
  sb: SupabaseClient,
  patientId: string
): Promise<MutationResult> {
  if (!isUuid(patientId)) return { ok: false, error: "invalid uuid (skipped)" };
  const { error } = await sb
    .from("patients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", patientId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function upsertAddressRemote(
  sb: SupabaseClient,
  customerId: string,
  a: Address
): Promise<MutationResult> {
  if (!isUuid(customerId) || !isUuid(a.id)) {
    return { ok: false, error: "invalid uuid (skipped)" };
  }
  if (a.isDefault) {
    await sb
      .from("addresses")
      .update({ is_default: false })
      .eq("customer_id", customerId)
      .neq("id", a.id);
  }
  const row = {
    id: a.id,
    customer_id: customerId,
    label: a.label,
    description: a.description,
    city: a.city,
    lat: a.lat,
    lng: a.lng,
    is_default: a.isDefault,
  };
  const { error } = await sb.from("addresses").upsert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: a.id };
}

export async function deleteAddressRemote(
  sb: SupabaseClient,
  addressId: string
): Promise<MutationResult> {
  if (!isUuid(addressId)) return { ok: false, error: "invalid uuid (skipped)" };
  const { error } = await sb
    .from("addresses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", addressId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setPaymentPrefRemote(
  sb: SupabaseClient,
  customerId: string,
  method: PaymentMethod
): Promise<MutationResult> {
  if (!isUuid(customerId)) return { ok: false, error: "invalid uuid (skipped)" };
  const { error } = await sb
    .from("customers")
    .update({ preferred_payment_method: method })
    .eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
