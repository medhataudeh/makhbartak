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

  // Phase 4.1.1 revenue formula:
  //   * Exclude `cancelled` and `refunded` (DB enum) from the orders sum.
  //   * Failed-to-collect maps to the DB `cancelled` enum already (see
  //     supabase/order-status.ts) so it's covered.
  //   * Cross-check with payment_status: also exclude any order whose
  //     payment_status is 'refunded'. This keeps revenue == "what the
  //     platform expects to receive (or has received and not refunded)".
  const [revenueRes, paidRes, txnRes, pendingCashRes] = await Promise.all([
    sb.from("orders")
      .select("total, payment_status", { count: "exact" })
      .not("status", "in", "(cancelled,refunded)"),
    // Phase 4.2: "paid" is now the broader paid-ish set; partial refunds
    // count net of refunded_amount.
    sb.from("payments")
      .select("amount, refunded_amount, status")
      .in("status", ["paid", "paid_by_nurse", "verified_by_admin", "partially_refunded"]),
    sb.from("nurse_wallet_transactions")
      .select("type, amount"),
    sb.from("nurse_wallets").select("balance"),
  ]);

  if (revenueRes.error)     return NextResponse.json({ error: revenueRes.error.message }, { status: 500 });
  if (paidRes.error)        return NextResponse.json({ error: paidRes.error.message }, { status: 500 });
  if (txnRes.error)         return NextResponse.json({ error: txnRes.error.message }, { status: 500 });
  if (pendingCashRes.error) return NextResponse.json({ error: pendingCashRes.error.message }, { status: 500 });

  const totalRevenue   = (revenueRes.data ?? []).reduce(
    (s, r) => (r as { payment_status?: string }).payment_status === "refunded" ? s : s + Number((r as { total?: number }).total ?? 0),
    0,
  );
  // Net collected = gross collected minus already-refunded portion.
  const totalCollected = (paidRes.data ?? []).reduce(
    (s, r) => s + Math.max(0, Number(r.amount ?? 0) - Number(r.refunded_amount ?? 0)),
    0,
  );
  const totalRefunded = (paidRes.data ?? []).reduce(
    (s, r) => s + Number(r.refunded_amount ?? 0),
    0,
  );

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

  // "Net" = what the platform earned (commission) minus refunds it absorbed.
  // Refunds are platform-absorbed because they unwind a prior collection.
  const netProfit = totalCommission - totalRefunded;

  return NextResponse.json({
    overview: {
      currency: "SYP",
      totalRevenue,
      totalCollected,
      totalRefunded,
      totalCommission,
      totalSettlements,
      totalAdjustments,
      pendingCashWithNurses,
      netProfit,
    },
  });
}
