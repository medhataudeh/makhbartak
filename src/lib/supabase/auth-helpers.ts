"use client";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── UUID guard ────────────────────────────────────────────────────────────
// Every Supabase column that expects uuid (customer_id, patient_id, …) MUST
// be validated before it leaves the client. Sending a non-uuid yields the
// runtime error: invalid input syntax for type uuid: "..." (PostgREST 22P02).
// This guard short-circuits those calls so dev/local fixture ids never leak.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Throw-style guard for callers that prefer fail-fast. */
export function assertUuid(value: unknown, label = "id"): asserts value is string {
  if (!isUuid(value)) {
    throw new Error(`[supabase] ${label} is not a valid uuid: ${String(value)}`);
  }
}

// ─── Dev session UUID ──────────────────────────────────────────────────────
// When the dev-OTP fallback is on we don't have a real Supabase session, so
// `auth.getUser()` returns null. Local writes still create rows that need a
// stable id (local-only); we persist a single uuid per browser so dev runs
// look like a real customer to the rest of the app — without ever sending
// that uuid to Supabase (the gate in getCurrentCustomerId enforces this).
const DEV_UUID_KEY = "makhbartak.dev.user.uuid";

export function getDevCustomerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(DEV_UUID_KEY);
    if (!id || !isUuid(id)) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEV_UUID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// ─── customer_id resolution (real Supabase session only) ──────────────────
// Returns the customers.id row that belongs to the currently signed-in user,
// or null if there is no real session, or the user has no customer row and
// auto-provisioning failed.
//
// The result is cached per session so we don't repeat the round-trip on every
// read. Caller invalidates with clearCustomerIdCache() on auth-state changes.
let _cache: { userId: string; customerId: string | null } | null = null;

export async function getCurrentCustomerId(
  sb: SupabaseClient
): Promise<string | null> {
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes.user;
  if (!user) return null;
  if (!isUuid(user.id)) return null; // defensive: dev stub should never reach here
  if (_cache && _cache.userId === user.id) return _cache.customerId;

  let customerId: string | null = null;
  const { data, error } = await sb
    .from("customers")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!error && data) {
    customerId = data.id as string;
  } else if (!error && !data) {
    // Auto-provision: a real auth user with no customers row gets one created.
    // The schema's profiles trigger creates the profile row automatically;
    // customers is the only domain row we need to bootstrap.
    const { data: created, error: insertErr } = await sb
      .from("customers")
      .insert({ profile_id: user.id })
      .select("id")
      .single();
    if (!insertErr && created) customerId = created.id as string;
    else if (insertErr) console.warn("[supabase] customer auto-provision failed", insertErr);
  } else if (error) {
    console.warn("[supabase] customer lookup failed", error);
  }

  _cache = { userId: user.id, customerId };
  return customerId;
}

export function clearCustomerIdCache() {
  _cache = null;
}
