import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// Phase 3.6: average + count per nurse and per lab. Returned as two arrays:
//   nurses: [{ nurse_id, count, average }]
//   labs:   [{ lab_id,   count, average }]
// The leaderboard joins on nurse_id; the lab portal joins on lab_id.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("order_ratings")
    .select("nurse_id, lab_id, overall_rating, nurse_rating, lab_rating");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nurseAgg = new Map<string, { sum: number; count: number }>();
  const labAgg = new Map<string, { sum: number; count: number }>();
  for (const r of data ?? []) {
    const nurseScore = r.nurse_rating ?? r.overall_rating;
    const labScore = r.lab_rating ?? r.overall_rating;
    if (r.nurse_id && Number.isFinite(nurseScore)) {
      const entry = nurseAgg.get(r.nurse_id as string) ?? { sum: 0, count: 0 };
      entry.sum += nurseScore as number;
      entry.count += 1;
      nurseAgg.set(r.nurse_id as string, entry);
    }
    if (r.lab_id && Number.isFinite(labScore)) {
      const entry = labAgg.get(r.lab_id as string) ?? { sum: 0, count: 0 };
      entry.sum += labScore as number;
      entry.count += 1;
      labAgg.set(r.lab_id as string, entry);
    }
  }
  const toArr = (m: Map<string, { sum: number; count: number }>, key: "nurse_id" | "lab_id") =>
    Array.from(m.entries()).map(([id, v]) => ({
      [key]: id,
      count: v.count,
      average: v.count > 0 ? Math.round((v.sum / v.count) * 10) / 10 : 0,
    }));
  return NextResponse.json({
    nurses: toArr(nurseAgg, "nurse_id"),
    labs: toArr(labAgg, "lab_id"),
  });
}
