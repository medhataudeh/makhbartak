"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
// Pure UUID guards live in `./uuid` so server code (Route Handlers) can use
// them without dragging in this file's "use client" boundary. Re-exported
// here for back-compat with existing client callers.
import { isUuid } from "./uuid";
export { isUuid, assertUuid } from "./uuid";

// FINAL CLEANUP: the legacy dev-OTP `getDevCustomerId` helper has been
// removed. It had no remaining callers and its localStorage key
// (`makhbartak.dev.user.uuid`) is no longer touched. Real Supabase Auth
// always supplies the user id; nothing else may invent one.

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
