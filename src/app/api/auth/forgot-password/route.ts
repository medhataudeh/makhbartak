import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { rateLimit } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";

interface ForgotBody {
  email: string;
  // Caller passes the origin (window.location.origin) so the recovery link
  // points back at this deployment.
  origin: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  // Per-IP cap: 5 attempts every 10 minutes. Supabase's own rate limiting
  // applies independently; this guards against credential-existence
  // enumeration via the 200-always answer.
  const rl = rateLimit(req, { bucket: "auth:forgot-password", max: 5, windowMs: 10 * 60_000 });
  if (!rl.ok) return rl.response!;
  let body: ForgotBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const origin = (body.origin ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "البريد الإلكتروني غير صالح" }, { status: 400 });
  }
  if (!origin) {
    return NextResponse.json({ error: "origin is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  // Always answer 200 to avoid leaking which emails are registered.
  // resetPasswordForEmail is rate-limited by Supabase; a non-existent address
  // simply returns silently.
  const redirectTo = `${origin.replace(/\/$/, "")}/auth/reset-password`;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    logger.warn("auth/forgot-password resetPasswordForEmail failed", {
      route: "api/auth/forgot-password",
      code: error.code ?? null,
    });
    // Still return 200 — UI shows generic Arabic confirmation.
  }
  return NextResponse.json({ ok: true });
}
