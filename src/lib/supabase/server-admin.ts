import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client. RLS-bypassing. Server-only — never imported from a
// client component or any "use client" module. The "server-only" import at
// the top of this file makes Next throw a build error if a client module
// tries to pull this in.

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
  _admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
