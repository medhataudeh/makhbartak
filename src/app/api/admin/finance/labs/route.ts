import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";
import { logger } from "@/lib/logger";

// Phase 5.2 — per-lab finance rollup for the admin dashboard. Reads from the
// lab_finance_summary view (mig 036).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("lab_finance_summary")
    .select("lab_id, lab_name, total_earnings, total_settled, total_adjustments, completed_orders, avg_earning_per_order, net_due")
    .order("net_due", { ascending: false });
  if (error) {
    logger.error("admin/finance/labs failed", { route: "api/admin/finance/labs", code: error.code });
    return NextResponse.json({ error: "تعذر قراءة مالية المخابر" }, { status: 500 });
  }

  type Row = {
    lab_id: string; lab_name: string | null;
    total_earnings: number; total_settled: number; total_adjustments: number;
    completed_orders: number; avg_earning_per_order: number; net_due: number;
  };
  const labs = (data ?? []).map((r) => {
    const row = r as Row;
    return {
      labId:           row.lab_id,
      labName:         row.lab_name ?? "—",
      totalEarnings:   Number(row.total_earnings ?? 0),
      totalSettled:    Number(row.total_settled ?? 0),
      totalAdjustments: Number(row.total_adjustments ?? 0),
      completedOrders: Number(row.completed_orders ?? 0),
      avgEarning:      Number(row.avg_earning_per_order ?? 0),
      netDue:          Number(row.net_due ?? 0),
      currency:        "SYP" as const,
    };
  });
  return NextResponse.json({ labs });
}
