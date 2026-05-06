import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// Per-nurse rollup: collected, commission, settled, net_due. Reads the
// nurse_finance_summary view from migration 031 so the math stays in one
// place and matches the ledger.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurse_finance_summary")
    .select("nurse_id, nurse_name, total_collected, total_commission, total_settled, total_adjustments, net_due")
    .order("net_due", { ascending: false });
  if (error) {
    const { logger } = await import("@/lib/logger");
    logger.error("admin/finance/nurse-wallets failed", { route: "api/admin/finance/nurse-wallets", code: error.code });
    return NextResponse.json({ error: "تعذر قراءة محافظ الممرضين" }, { status: 500 });
  }

  type Row = {
    nurse_id: string; nurse_name: string | null;
    total_collected: number; total_commission: number;
    total_settled: number; total_adjustments: number; net_due: number;
  };
  const wallets = (data ?? []).map((r) => {
    const row = r as Row;
    return {
      nurseId:         row.nurse_id,
      nurseName:       row.nurse_name ?? "—",
      totalCollected:  Number(row.total_collected ?? 0),
      totalCommission: Number(row.total_commission ?? 0),
      totalSettled:    Number(row.total_settled ?? 0),
      totalAdjustments: Number(row.total_adjustments ?? 0),
      netDue:          Number(row.net_due ?? 0),
      currency:        "SYP" as const,
    };
  });
  return NextResponse.json({ wallets });
}
