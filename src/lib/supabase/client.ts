"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Browser-side Supabase client. Returns `null` when env vars are missing
 * so the app degrades gracefully (legacy stores stay in charge).
 *
 * Usage:
 *   const sb = getSupabaseBrowser();
 *   if (!sb) { /* fall back to legacy store *​/ }
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  if (_client) return _client;
  _client = createBrowserClient(url, anon);
  return _client;
}
