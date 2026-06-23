import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";

interface SetOnlineBody {
  isOnline: boolean;
}

// POST /api/nurses/[id]/online
// Toggles `nurses.is_online`. Used by the nurse app to mark "I'm starting
// a shift" / "I'm offline now". The morning prep checklist surfaces only
// during the off→on transition (handled client-side from this state).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireNurseSelfOrAdmin(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: SetOnlineBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const isOnline = !!body.isOnline;

  const sb = getSupabaseAdmin();

  // Server-side day-start gate: a nurse may only go online after confirming
  // prep quantities that COVER the required quantities for today's assigned
  // orders (Asia/Damascus). The required amounts are computed canonically in
  // check_nurse_prep_coverage (orders → order_items → lab_test_required_tools),
  // not trusted from the client. Admins toggling a nurse online (operational
  // override) bypass the gate. Going offline is never gated.
  if (isOnline && auth.session.role === "nurse") {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus" }).format(new Date());
    const { data: coverage, error: covErr } = await sb.rpc("check_nurse_prep_coverage", {
      p_nurse_id: id,
      p_work_date: today,
    });
    if (covErr) {
      console.error("[api/nurses/online] coverage check failed", { id, code: covErr.code, message: covErr.message });
      return NextResponse.json({ error: "تعذر التحقق من جاهزية الأدوات" }, { status: 500 });
    }
    const cov = coverage as {
      ok: boolean;
      reason: string | null;
      shortfalls: { nameAr: string; unit: string; required: number; prepared: number }[];
    } | null;
    if (!cov?.ok) {
      if (cov?.reason === "no_confirmation") {
        return NextResponse.json({ error: "يجب تأكيد جاهزية الأدوات قبل بدء اليوم" }, { status: 409 });
      }
      const list = (cov?.shortfalls ?? [])
        .map((s) => `${s.nameAr} (المطلوب ${s.required}${s.unit ? " " + s.unit : ""}، المجهّز ${s.prepared})`)
        .join("، ");
      return NextResponse.json(
        {
          error: list
            ? `الكميات المجهّزة غير كافية لبدء اليوم: ${list}`
            : "الكميات المجهّزة غير كافية لبدء اليوم",
          shortfalls: cov?.shortfalls ?? [],
        },
        { status: 409 },
      );
    }
  }

  const { error } = await sb
    .from("nurses")
    .update({
      is_online: isOnline,
      online_since: isOnline ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) {
    console.error("[api/nurses/online] update failed", { id, code: error.code, message: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, isOnline });
}

// GET /api/nurses/[id]/online → current flag.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireNurseSelfOrAdmin(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurses").select("is_online, online_since").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ isOnline: !!data?.is_online, onlineSince: data?.online_since ?? null });
}
