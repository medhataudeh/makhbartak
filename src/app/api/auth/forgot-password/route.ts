import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";

interface ForgotBody {
  email: string;
  // Caller passes the origin (window.location.origin) so the recovery link
  // points back at this deployment.
  origin: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
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
    console.warn("[api/auth/forgot-password] resetPasswordForEmail failed", error.message);
    // Still return 200 — UI shows generic Arabic confirmation.
  }
  return NextResponse.json({ ok: true });
}
