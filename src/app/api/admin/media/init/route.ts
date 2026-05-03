import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-auth";
import { ensureMediaInfra } from "@/lib/supabase/ensure-media-infra";

// POST /api/admin/media/init
// One-tap bootstrap for the media infrastructure. Idempotent: creates the
// `media` storage bucket if missing and confirms the metadata table is in
// place. The admin Media Library calls this from a "إصلاح" button when an
// upload fails so the operator can self-heal without leaving the dashboard.
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const result = await ensureMediaInfra({ force: true });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, details: result.details }, { status: 500 });
  }
  return NextResponse.json(result);
}
