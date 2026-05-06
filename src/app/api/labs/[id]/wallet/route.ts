import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { logger } from "@/lib/logger";

// Phase 5.2 — lab finance read. Returns the lab wallet row + summary +
// latest 200 ledger transactions. Lab user must belong to the lab; admin
// can read any lab.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: labId } = await ctx.params;
  if (!isUuid(labId)) return NextResponse.json({ error: "lab id must be a uuid" }, { status: 400 });

  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "admin") {
    if (auth.session.role !== "lab" || auth.session.labId !== labId) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const type = url.searchParams.get("type");

  const sb = getSupabaseAdmin();

  const [walletRes, summaryRes, txnRes] = await Promise.all([
    sb.from("lab_wallets").select("balance, currency, updated_at").eq("lab_id", labId).maybeSingle(),
    sb.from("lab_finance_summary")
      .select("total_earnings, total_settled, total_adjustments, completed_orders, avg_earning_per_order, net_due")
      .eq("lab_id", labId).maybeSingle(),
    (() => {
      let q = sb.from("lab_wallet_transactions")
        .select(`
          id, lab_id, order_id, type, direction, amount, currency,
          description_ar, payout_snapshot, created_at,
          order:orders ( public_number )
        `)
        .eq("lab_id", labId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (type) q = q.eq("type", type);
      if (from) q = q.gte("created_at", `${from}T00:00:00.000Z`);
      if (to)   q = q.lte("created_at", `${to}T23:59:59.999Z`);
      return q;
    })(),
  ]);

  const firstError = walletRes.error ?? summaryRes.error ?? txnRes.error;
  if (firstError) {
    logger.error("labs/wallet read failed", { route: "api/labs/wallet", labId, code: firstError.code });
    return NextResponse.json({ error: "تعذر قراءة بيانات المالية" }, { status: 500 });
  }

  type Row = {
    id: string; lab_id: string; order_id: string | null; type: string; direction: string;
    amount: number; currency: string; description_ar: string;
    payout_snapshot: unknown; created_at: string;
    order: { public_number: string | null }[] | null;
  };
  const transactions = ((txnRes.data ?? []) as unknown as Row[]).map((r) => {
    const orderRow = Array.isArray(r.order) ? r.order[0] : null;
    return {
      id:             r.id,
      orderId:        r.order_id,
      orderPublicNumber: orderRow?.public_number ?? null,
      type:           r.type,
      direction:      r.direction,
      amount:         Number(r.amount ?? 0),
      currency:       r.currency ?? "SYP",
      descriptionAr:  r.description_ar,
      payoutSnapshot: r.payout_snapshot,
      createdAt:      r.created_at,
    };
  });

  type Summary = {
    total_earnings?: number; total_settled?: number; total_adjustments?: number;
    completed_orders?: number; avg_earning_per_order?: number; net_due?: number;
  };
  const s = (summaryRes.data ?? null) as Summary | null;

  return NextResponse.json({
    wallet: {
      balance:  Number(walletRes.data?.balance ?? 0),
      currency: walletRes.data?.currency ?? "SYP",
      updatedAt: walletRes.data?.updated_at ?? null,
    },
    summary: {
      totalEarnings:    Number(s?.total_earnings ?? 0),
      totalSettled:     Number(s?.total_settled ?? 0),
      totalAdjustments: Number(s?.total_adjustments ?? 0),
      completedOrders:  Number(s?.completed_orders ?? 0),
      avgEarning:       Number(s?.avg_earning_per_order ?? 0),
      netDue:           Number(s?.net_due ?? 0),
    },
    transactions,
  });
}
