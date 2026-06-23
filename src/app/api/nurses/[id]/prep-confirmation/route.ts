import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ConfirmBody {
  workDate: string;
  confirmedItems?: string[];
}

// GET /api/nurses/[id]/prep-confirmation?day=YYYY-MM-DD
// Returns the daily prep confirmation row for that nurse/date, or null.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireNurseSelfOrAdmin(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const day = new URL(req.url).searchParams.get("day");
  if (!day || !DATE_RE.test(day)) {
    return NextResponse.json({ error: "day query param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurse_daily_prep_confirmations")
    .select("nurse_id, work_date, confirmed_at, confirmed_items")
    .eq("nurse_id", id)
    .eq("work_date", day)
    .maybeSingle();
  if (error) {
    console.error("[api/nurses/prep-confirmation] read failed", { id, code: error.code, message: error.message });
    return NextResponse.json({ error: "تعذر تحميل تأكيد الجاهزية" }, { status: 500 });
  }
  return NextResponse.json({ confirmation: data ?? null });
}

// POST /api/nurses/[id]/prep-confirmation
// Records (idempotently) that the nurse confirmed prepping the day's tools.
// This is the auditable event the /online route gates "starting the day" on.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireNurseSelfOrAdmin(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: ConfirmBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const day = body?.workDate;
  if (!day || !DATE_RE.test(day)) {
    return NextResponse.json({ error: "workDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const items = Array.isArray(body.confirmedItems) ? body.confirmedItems : [];

  const sb = getSupabaseAdmin();
  const { error } = await sb.rpc("confirm_nurse_daily_prep", {
    p_nurse_id: id,
    p_work_date: day,
    p_confirmed_items: items,
  });
  if (error) {
    console.error("[api/nurses/prep-confirmation] confirm failed", { id, code: error.code, message: error.message });
    return NextResponse.json({ error: "تعذر حفظ تأكيد الجاهزية" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
