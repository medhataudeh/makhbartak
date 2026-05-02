// Single source of truth for the gradual Supabase migration.
// Defaults to OFF so the legacy localStorage stores remain authoritative
// until each store is wired up and you flip the flag.
//
// Set `NEXT_PUBLIC_USE_SUPABASE=true` in `.env.local` (and on Vercel)
// to start routing supported reads/writes through Supabase.
export const USE_SUPABASE: boolean =
  (process.env.NEXT_PUBLIC_USE_SUPABASE ?? "").toLowerCase() === "true";

/** True only when both env vars are present at build/runtime. */
export function supabaseEnvReady(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Dev-only fallback for phone OTP. When true, the verify step accepts the
 * fixed code "123456" so local development doesn't need a real SMS provider.
 * Production MUST leave this off.
 */
export const USE_DEV_OTP: boolean =
  (process.env.NEXT_PUBLIC_USE_SUPABASE_DEV_OTP ?? "").toLowerCase() === "true";

export const DEV_OTP_CODE = "123456";
