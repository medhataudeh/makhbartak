import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";
import { logger } from "@/lib/logger";

// Phase 5.2 — admin settlement creation for a lab.
//   POST: record_lab_settlement_admin RPC (atomic).
//   GET:  list of settlement_paid + adjustment txns for the lab.

interface PostBody {
  amount: number;
  note?: string;
  forceAdjustment?: boolean;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: labId } = await ctx.params;
  if (!isUuid(labId)) return NextResponse.json({ error: "lab id must be a uuid" }, { status: 400 });
  const auth = await requireAdminCap("finance.read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("lab_wallet_transactions")
    .select("id, type, amount, currency, description_ar, created_at, created_by")
    .eq("lab_id", labId)
    .in("type", ["settlement_paid", "adjustment"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    logger.error("admin/finance/labs/settlements GET failed", { route: "api/admin/finance/labs/settlements", labId, code: error.code });
    return NextResponse.json({ error: "تعذر قراءة التسويات" }, { status: 500 });
  }
  return NextResponse.json({ settlements: data ?? [] });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: labId } = await ctx.params;
  if (!isUuid(labId)) return NextResponse.json({ error: "lab id must be a uuid" }, { status: 400 });
  const auth = await requireAdminCap("finance.settlement.write");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: PostBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const numericAmount = Number(body.amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: "المبلغ يجب أن يكون أكبر من صفر" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("record_lab_settlement_admin", {
    p_lab_id:           labId,
    p_amount:           numericAmount,
    p_admin_id:         auth.session.userId,
    p_note:             body.note ?? null,
    p_force_adjustment: !!body.forceAdjustment,
  });
  if (error) {
    const msg = error.message ?? "تعذر تسجيل التسوية";
    const isBusiness = typeof msg === "string" && (
      msg.includes("يتجاوز المستحق") || msg.includes("أكبر من صفر") || msg.includes("غير موجود")
    );
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    logger.error("admin/finance/labs/settlements POST failed", { route: "api/admin/finance/labs/settlements", labId, code: error.code });
    return NextResponse.json({ error: "تعذر تسجيل التسوية" }, { status: 500 });
  }

  await logAdminActivity(
    sb,
    auth.session,
    "settings_change",
    "lab_settlement",
    labId,
    `${body.forceAdjustment ? "adjustment" : "settlement"}:${numericAmount}${body.note ? `:${body.note}` : ""}`,
  );

  return NextResponse.json({ ok: true, transactionId: data });
}
