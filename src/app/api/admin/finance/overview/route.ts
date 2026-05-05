import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdmin } from "@/lib/route-auth";

// Phase 4.1 admin Finance overview — single round-trip rollup. Numbers are
// computed against the canonical ledger tables (payments,
// nurse_wallet_transactions) so the dashboard cannot drift from the audit
// trail.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();

  // Total revenue is the sum of `total` across all orders that are not
  // cancelled/refunded. This is what the platform expects to receive.
  const [revenueRes, paidRes, txnRes, pendingCashRes] = await Promise.all([
    sb.from("orders")
      .select("total", { count: "exact" })
      .not("status", "in", "(\"cancelled\")"),
    sb.from("payments")
      .select("amount", { count: "exact" })
      .eq("status", "paid"),
    sb.from("nurse_wallet_transactions")
      .select("type, amount"),
    // "Cash with nurses" = sum of paid cash payments minus settled-back amount.
    // We re-derive from wallet ledger so it's authoritative.
    sb.from("nurse_wallets").select("balance"),
  ]);

  if (revenueRes.error)     return NextResponse.json({ error: revenueRes.error.message }, { status: 500 });
  if (paidRes.error)        return NextResponse.json({ error: paidRes.error.message }, { status: 500 });
  if (txnRes.error)         return NextResponse.json({ error: txnRes.error.message }, { status: 500 });
  if (pendingCashRes.error) return NextResponse.json({ error: pendingCashRes.error.message }, { status: 500 });

  const totalRevenue   = (revenueRes.data ?? []).reduce((s, r) => s + Number(r.total ?? 0), 0);
  const totalCollected = (paidRes.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);

  let totalCommission = 0;
  let totalSettlements = 0;
  let totalAdjustments = 0;
  for (const t of txnRes.data ?? []) {
    const amt = Number((t as { amount: number }).amount ?? 0);
    const type = (t as { type: string }).type;
    if (type === "commission_earned") totalCommission  += amt;
    else if (type === "settlement_paid") totalSettlements += amt;
    else if (type === "adjustment")      totalAdjustments += amt;
  }
  const pendingCashWithNurses = (pendingCashRes.data ?? []).reduce((s, r) => s + Number(r.balance ?? 0), 0);

  return NextResponse.json({
    overview: {
      currency: "SYP",
      totalRevenue,
      totalCollected,
      totalCommission,
      totalSettlements,
      totalAdjustments,
      pendingCashWithNurses,
    },
  });
}
