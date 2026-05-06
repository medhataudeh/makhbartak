import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { logger } from "@/lib/logger";
import { safeApiError } from "@/lib/api/safe-error";

// Phase 5.1 P0 fix — lab users can only confirm orders that belong to their
// lab. Previously a lab session could call this for any lab's order, which
// triggered completion + commission on someone else's flow.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "lab" && auth.session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();

  // Ownership re-check on every lab session. Admins are not bound to a lab.
  if (auth.session.role === "lab") {
    if (!auth.session.labId) {
      return NextResponse.json(
        { error: "حساب المختبر غير مكتمل. تواصل مع الإدارة." },
        { status: 403 },
      );
    }
    const { data: row, error: rowErr } = await sb
      .from("orders").select("id, lab_id").eq("id", orderId).maybeSingle();
    if (rowErr) {
      const safe = safeApiError(rowErr, {
        route: "api/orders/lab/confirm",
        fallback: "تعذر قراءة الطلب من قاعدة البيانات",
        context: { orderId },
      });
      return NextResponse.json(safe.body, { status: safe.status });
    }
    if (!row) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    if (row.lab_id !== auth.session.labId) {
      logger.warn("lab confirm refused — cross-lab attempt", {
        route: "api/orders/lab/confirm",
        orderId, expected: row.lab_id, sessionLabId: auth.session.labId,
      });
      return NextResponse.json(
        { error: "لا تملك صلاحية تأكيد نتائج هذا الطلب" },
        { status: 403 },
      );
    }
  }

  const { count, error: countErr } = await sb
    .from("lab_result_files")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("status", "active");
  if (countErr) {
    const safe = safeApiError(countErr, {
      route: "api/orders/lab/confirm",
      fallback: "تعذر التحقق من ملفات النتائج",
      context: { orderId },
    });
    return NextResponse.json(safe.body, { status: safe.status });
  }
  if (!count || count < 1) {
    return NextResponse.json({ error: "no_active_result_files" }, { status: 409 });
  }

  const { error: rpcErr } = await sb.rpc("set_order_status_admin", {
    p_order_id: orderId,
    p_status: "completed",
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    p_note: "تأكيد إرسال النتائج",
  });
  if (rpcErr) {
    const safe = safeApiError(rpcErr, {
      route: "api/orders/lab/confirm",
      fallback: "تعذر تأكيد النتائج. حاول مرة أخرى.",
      context: { orderId },
    });
    return NextResponse.json(safe.body, { status: safe.status });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
