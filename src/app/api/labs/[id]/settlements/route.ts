import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin, requireAuthedUser } from "@/lib/route-auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface GenerateBody {
  periodStart: string;
  periodEnd: string;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: labId } = await ctx.params;
  if (!isUuid(labId)) {
    return NextResponse.json({ error: "lab id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role === "lab") {
    if (!auth.session.labId || auth.session.labId !== labId) {
      return NextResponse.json({ error: "cannot view another lab" }, { status: 403 });
    }
  } else if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("settlements")
    .select(`
      id, lab_id, period_start, period_end, total_orders, total_lab_amount,
      total_paid, status, notes, created_at, updated_at,
      items:settlement_items ( id, order_id, lab_amount, status )
    `)
    .eq("lab_id", labId)
    .order("period_end", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settlements: data ?? [] });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: labId } = await ctx.params;
  if (!isUuid(labId)) {
    return NextResponse.json({ error: "lab id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: GenerateBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { periodStart, periodEnd } = body ?? {};
  if (!DATE_RE.test(periodStart ?? "") || !DATE_RE.test(periodEnd ?? "")) {
    return NextResponse.json({ error: "periodStart and periodEnd must be YYYY-MM-DD" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: settlementId, error: rpcErr } = await sb.rpc("generate_lab_settlement_admin", {
    p_lab_id: labId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_actor_role: "admin",
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, settlementId });
}
