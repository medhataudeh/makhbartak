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
  const [revenueRes, paidRes, txnRes, pendingCashRes, labTxnRes, labWalletRes, topNursesRes, topLabsRes] = await Promise.all([
    sb.from("orders")
      .select("total, payment_status", { count: "exact" })
      .not("status", "in", "(cancelled,refunded)"),
    sb.from("payments")
      .select("amount, refunded_amount, status")
      .in("status", ["paid", "paid_by_nurse", "verified_by_admin", "partially_refunded"]),
    sb.from("nurse_wallet_transactions")
      .select("type, amount"),
    sb.from("nurse_wallets").select("balance"),
    // Phase 5.2 — lab finance aggregates.
    sb.from("lab_wallet_transactions").select("type, amount"),
    sb.from("lab_wallets").select("balance"),
    sb.from("nurse_finance_summary")
      .select("nurse_id, nurse_name, total_collected, net_due")
      .order("total_collected", { ascending: false })
      .limit(5),
    sb.from("lab_finance_summary")
      .select("lab_id, lab_name, total_earnings, completed_orders, net_due")
      .order("total_earnings", { ascending: false })
      .limit(5),
  ]);

  const firstError = revenueRes.error ?? paidRes.error ?? txnRes.error ?? pendingCashRes.error
    ?? labTxnRes.error ?? labWalletRes.error ?? topNursesRes.error ?? topLabsRes.error;
  if (firstError) {
    const { logger } = await import("@/lib/logger");
    logger.error("admin/finance/overview failed", { route: "api/admin/finance/overview", code: firstError.code });
    return NextResponse.json({ error: "تعذر قراءة الملخص المالي" }, { status: 500 });
  }

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

  // Phase 5.2 — lab side of the ledger.
  let totalLabEarnings = 0;
  let totalLabSettlements = 0;
  let totalLabAdjustments = 0;
  for (const t of labTxnRes.data ?? []) {
    const amt = Number((t as { amount: number }).amount ?? 0);
    const type = (t as { type: string }).type;
    if (type === "earning")              totalLabEarnings    += amt;
    else if (type === "settlement_paid") totalLabSettlements += amt;
    else if (type === "adjustment")      totalLabAdjustments += amt;
  }
  const pendingLabBalances = (labWalletRes.data ?? []).reduce((s, r) => s + Number(r.balance ?? 0), 0);

  // Net = commission earned − refunds absorbed − lab earnings paid out
  //       (or scheduled to be paid out via settlements).
  // platformNetAfterLabs is the same idea expressed as the running platform
  // share AFTER the lab share leaves the system.
  const netProfit = totalCommission - totalRefunded;
  const platformNetAfterLabs = totalCollected - totalRefunded - totalLabEarnings;

  type NurseRow = { nurse_id: string; nurse_name: string | null; total_collected: number; net_due: number };
  type LabRow = { lab_id: string; lab_name: string | null; total_earnings: number; completed_orders: number; net_due: number };
  const topNurses = ((topNursesRes.data ?? []) as NurseRow[]).map((r) => ({
    nurseId: r.nurse_id, nurseName: r.nurse_name ?? "—",
    totalCollected: Number(r.total_collected ?? 0), netDue: Number(r.net_due ?? 0),
  }));
  const topLabs = ((topLabsRes.data ?? []) as LabRow[]).map((r) => ({
    labId: r.lab_id, labName: r.lab_name ?? "—",
    totalEarnings: Number(r.total_earnings ?? 0), completedOrders: Number(r.completed_orders ?? 0),
    netDue: Number(r.net_due ?? 0),
  }));

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
      // Phase 5.2 lab fields.
      totalLabEarnings,
      totalLabSettlements,
      totalLabAdjustments,
      pendingLabBalances,
      platformNetAfterLabs,
      netProfit,
      topNurses,
      topLabs,
    },
  });
}
