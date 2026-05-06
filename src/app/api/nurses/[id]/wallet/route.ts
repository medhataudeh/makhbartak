import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";
import { logger } from "@/lib/logger";

// Phase 5.2 — nurse-self / admin wallet read. Returns the wallet row +
// the latest 200 ledger transactions (filterable client-side). The numbers
// are read straight from the canonical ledger so the UI cannot drift.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireNurseSelfOrAdmin(nurseId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const type = url.searchParams.get("type");

  const sb = getSupabaseAdmin();

  const [walletRes, summaryRes, txnRes] = await Promise.all([
    sb.from("nurse_wallets").select("balance, currency, updated_at").eq("nurse_id", nurseId).maybeSingle(),
    sb.from("nurse_finance_summary")
      .select("total_collected, total_commission, total_settled, total_adjustments, total_refunded, net_due")
      .eq("nurse_id", nurseId).maybeSingle(),
    (() => {
      let q = sb.from("nurse_wallet_transactions")
        .select(`
          id, nurse_id, order_id, payment_id, type, direction, amount, currency,
          description_ar, commission_rate_snapshot, created_at,
          order:orders ( public_number )
        `)
        .eq("nurse_id", nurseId)
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
    logger.error("nurses/wallet read failed", { route: "api/nurses/wallet", nurseId, code: firstError.code });
    return NextResponse.json({ error: "تعذر قراءة المحفظة" }, { status: 500 });
  }

  type Row = {
    id: string; nurse_id: string; order_id: string | null; payment_id: string | null;
    type: string; direction: string; amount: number; currency: string;
    description_ar: string; commission_rate_snapshot: number | null; created_at: string;
    order: { public_number: string | null }[] | null;
  };
  const transactions = ((txnRes.data ?? []) as unknown as Row[]).map((r) => {
    const orderRow = Array.isArray(r.order) ? r.order[0] : null;
    return {
      id:             r.id,
      orderId:        r.order_id,
      orderPublicNumber: orderRow?.public_number ?? null,
      paymentId:      r.payment_id,
      type:           r.type,
      direction:      r.direction,
      amount:         Number(r.amount ?? 0),
      currency:       r.currency ?? "SYP",
      descriptionAr:  r.description_ar,
      commissionRate: r.commission_rate_snapshot === null || r.commission_rate_snapshot === undefined ? null : Number(r.commission_rate_snapshot),
      createdAt:      r.created_at,
    };
  });

  type Summary = {
    total_collected?: number; total_commission?: number; total_settled?: number;
    total_adjustments?: number; total_refunded?: number; net_due?: number;
  };
  const s = (summaryRes.data ?? null) as Summary | null;

  return NextResponse.json({
    wallet: {
      balance:  Number(walletRes.data?.balance ?? 0),
      currency: walletRes.data?.currency ?? "SYP",
      updatedAt: walletRes.data?.updated_at ?? null,
    },
    summary: {
      totalCollected:  Number(s?.total_collected ?? 0),
      totalCommission: Number(s?.total_commission ?? 0),
      totalSettled:    Number(s?.total_settled ?? 0),
      totalAdjustments: Number(s?.total_adjustments ?? 0),
      totalRefunded:   Number(s?.total_refunded ?? 0),
      netDue:          Number(s?.net_due ?? 0),
    },
    transactions,
  });
}
