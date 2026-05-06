import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

interface VerifyPatientBody {
  officialName: string;
  nationalId?: string;
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "admin" && auth.session.role !== "nurse") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  let body: VerifyPatientBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.officialName || !body.officialName.trim()) {
    return NextResponse.json({ error: "officialName is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Ownership pre-flight: a nurse may only verify the patient on their own
  // assigned order. The route also back-fills patients.national_id below,
  // so without this check a nurse could mutate another nurse's patient
  // record. Admin is unrestricted.
  if (auth.session.role === "nurse") {
    if (!auth.session.nurseId) {
      return NextResponse.json(
        { error: "حساب الممرض غير مكتمل. تواصل مع الإدارة." },
        { status: 403 },
      );
    }
    const { data: row, error: rowErr } = await sb
      .from("orders").select("id, nurse_id").eq("id", orderId).maybeSingle();
    if (rowErr) {
      return NextResponse.json({ error: "تعذر قراءة الطلب من قاعدة البيانات" }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }
    if (row.nurse_id !== auth.session.nurseId) {
      return NextResponse.json({ error: "هذا الطلب غير مخصص لك" }, { status: 403 });
    }
  }

  const { error: rpcErr } = await sb.rpc("verify_patient_admin", {
    p_order_id: orderId,
    p_official_name: body.officialName,
    p_national_id: body.nationalId ?? null,
    p_note: body.note ?? null,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) {
    console.error("[api/orders/verify-patient] rpc failed", {
      code: rpcErr.code, message: rpcErr.message, details: rpcErr.details, orderId,
    });
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // Back-fill the patient row's national_id when the nurse confirms one and
  // the patient record didn't have it. Subsequent orders for the same
  // patient then prefill automatically; the nurse never re-types the same id.
  const trimmedNationalId = body.nationalId?.trim();
  if (trimmedNationalId) {
    const { data: orderRow } = await sb
      .from("orders").select("patient_id").eq("id", orderId).maybeSingle();
    if (orderRow?.patient_id) {
      const { data: patientRow } = await sb
        .from("patients").select("id, national_id").eq("id", orderRow.patient_id).maybeSingle();
      if (patientRow && !patientRow.national_id) {
        const { error: updErr } = await sb
          .from("patients")
          .update({ national_id: trimmedNationalId })
          .eq("id", patientRow.id);
        if (updErr) {
          console.warn("[api/orders/verify-patient] patient national_id back-fill failed", updErr.message);
        }
      }
    }
  }

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
