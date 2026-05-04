import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";

// Phase 1: idempotent fetch-or-create for nurse_gamification. Used by
// NurseApp on mount and by AdminDashboard's NursesAdmin "adjust" sub-view
// when the admin opens a fresh nurse.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) {
    return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  }
  const auth = await requireNurseSelfOrAdmin(nurseId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("ensure_nurse_gamification_admin", {
    p_nurse_id: nurseId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ gamification: data });
}
