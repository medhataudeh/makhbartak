import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

// GET — list nurse settlement transactions (settlement_paid + adjustment).
// POST — admin records a settlement payment to a nurse via the
// record_nurse_settlement_admin RPC. Negative or balance-overflow attempts
// are refused with the Arabic copy from the RPC.

interface PostBody {
  nurseId: string;
  amount: number;
  note?: string;
  forceAdjustment?: boolean;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const nurseId = url.searchParams.get("nurseId");

  const sb = getSupabaseAdmin();
  let q = sb.from("nurse_wallet_transactions")
    .select(`
      id, nurse_id, type, direction, amount, currency, description_ar, created_at, created_by,
      nurse:nurses ( id, profile:profiles!inner ( full_name ) )
    `)
    .in("type", ["settlement_paid", "adjustment"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (nurseId) q = q.eq("nurse_id", nurseId);

  const { data, error } = await q;
  if (error) {
    const { logger } = await import("@/lib/logger");
    logger.error("admin/finance/settlements GET failed", { route: "api/admin/finance/settlements", code: error.code });
    return NextResponse.json({ error: "تعذر قراءة التسويات" }, { status: 500 });
  }

  type Row = {
    id: string; nurse_id: string; type: string; direction: string;
    amount: number; currency: string; description_ar: string;
    created_at: string; created_by: string | null;
    // The PostgREST embed for a to-one relation comes back as an array in the
    // generated types (the join target's row shape × N). At runtime we pull
    // the head element and treat it as scalar — same pattern other routes use.
    nurse: { profile: { full_name: string | null }[] | null }[] | null;
  };
  const settlements = (data ?? []).map((r) => {
    const row = r as unknown as Row;
    const nurseRow = Array.isArray(row.nurse) ? row.nurse[0] : null;
    const profileRow = nurseRow && Array.isArray(nurseRow.profile) ? nurseRow.profile[0] : null;
    return {
      id:           row.id,
      nurseId:      row.nurse_id,
      nurseName:    profileRow?.full_name ?? "—",
      type:         row.type,
      amount:       Number(row.amount ?? 0),
      currency:     row.currency ?? "SYP",
      descriptionAr: row.description_ar,
      createdAt:    row.created_at,
      createdBy:    row.created_by,
    };
  });
  return NextResponse.json({ settlements });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: PostBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { nurseId, amount, note, forceAdjustment } = body ?? ({} as PostBody);
  if (!nurseId || !isUuid(nurseId)) {
    return NextResponse.json({ error: "nurseId is required" }, { status: 400 });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: "المبلغ يجب أن يكون أكبر من صفر" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("record_nurse_settlement_admin", {
    p_nurse_id:         nurseId,
    p_amount:           numericAmount,
    p_admin_id:         auth.session.userId,
    p_note:             note ?? null,
    p_force_adjustment: !!forceAdjustment,
  });
  if (error) {
    const msg = error.message ?? "تعذر تسجيل التسوية";
    const isBusiness = typeof msg === "string" && (
      msg.includes("يتجاوز الرصيد") || msg.includes("أكبر من صفر")
    );
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[api/admin/finance/settlements] rpc failed", { code: error.code, message: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true, transactionId: data });
}
