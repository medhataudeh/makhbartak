import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// Phase 1: list all gamification rows for the admin leaderboard.
// Adjust-points + recompute jobs land in a future phase; this is read-only.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurse_gamification")
    .select(`
      nurse_id, total_completed, total_points, points_today,
      monthly_completed, monthly_points, failed_count, success_rate,
      streak, level_id
    `)
    .order("total_points", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
