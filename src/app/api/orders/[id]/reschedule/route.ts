import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";
import type { Shift } from "@/lib/types";

const SHIFTS: Shift[] = ["morning", "evening"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

interface RescheduleBody {
  visitDate: string;
  shift: Shift;
  shiftStartTime?: string;
  shiftEndTime?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: RescheduleBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { visitDate, shift, shiftStartTime, shiftEndTime } = body ?? {};
  if (!DATE_RE.test(visitDate ?? "")) {
    return NextResponse.json({ error: "visitDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!SHIFTS.includes(shift as Shift)) {
    return NextResponse.json({ error: "shift must be morning or evening" }, { status: 400 });
  }
  if (shiftStartTime && !TIME_RE.test(shiftStartTime)) {
    return NextResponse.json({ error: "shiftStartTime must be HH:MM[:SS]" }, { status: 400 });
  }
  if (shiftEndTime && !TIME_RE.test(shiftEndTime)) {
    return NextResponse.json({ error: "shiftEndTime must be HH:MM[:SS]" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("reschedule_order_admin", {
    p_order_id: orderId,
    p_visit_date: visitDate,
    p_shift: shift,
    p_shift_start_time: shiftStartTime ?? null,
    p_shift_end_time: shiftEndTime ?? null,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
