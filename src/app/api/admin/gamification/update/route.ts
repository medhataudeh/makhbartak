import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

interface PostBody {
  nurseId: string;
  delta: number;
}

// Phase 3: admin-only adjust of nurse_gamification.total_points. Wraps
// adjust_nurse_gamification_points_admin (migration 027). The previous
// in-memory mutation in AdminDashboard now calls this route and mirrors
// the canonical row back from the response.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  if (!isUuid(body.nurseId)) {
    return NextResponse.json({ error: "nurseId must be a uuid" }, { status: 400 });
  }
  const delta = Number(body.delta);
  if (!Number.isInteger(delta)) {
    return NextResponse.json({ error: "delta must be an integer" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("adjust_nurse_gamification_points_admin", {
    p_nurse_id: body.nurseId,
    p_delta: delta,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, gamification: data });
}
