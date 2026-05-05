import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { fetchOrderById, enrichOrdersWithSignedUrls } from "@/lib/supabase/queries/orders";
import { tsStatusToSql } from "@/lib/supabase/order-status";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";
import type { Order, OrderStatus, PaymentMethod, Shift } from "@/lib/types";

interface CreateAdminOrderBody {
  idempotencyKey: string;
  customerId: string;
  order: {
    type: "package" | "custom" | "prescription";
    packageId?: string;
    packageSnapshot?: unknown;
    items: Array<{
      testId: string;
      nameAr: string;
      nameEn?: string;
      priceSnapshot: number;
    }>;
    subtotal: number;
    couponCode?: string;
    couponDiscount: number;
    total: number;
    shift: Shift;
    visitDate: string;
    shiftStartTime?: string;
    shiftEndTime?: string;
    patientId: string;
    addressId: string;
    paymentMethod: PaymentMethod;
    paymentStatus: "pending" | "paid" | "failed";
    initialStatus: OrderStatus;
    prescriptionUrl?: string;
  };
  /** Optional admin overrides for the auto-assignment that fires after place_order_admin. */
  assignNurseId?: string;
  assignLabId?: string;
}

// Phase 3.8 P0: admin-side order creation. The customer-side /api/orders
// gates on `session.role === "customer"`; this admin counterpart accepts
// an explicit customerId and runs the same place_order_admin RPC + the
// auto-assign step. Service-role only — admins can create orders on
// behalf of any customer in the catalog.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: CreateAdminOrderBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { idempotencyKey, customerId, order, assignNurseId, assignLabId } = body ?? {};
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return NextResponse.json({ error: "idempotencyKey required" }, { status: 400 });
  }
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customerId must be a uuid" }, { status: 400 });
  }
  if (!isUuid(order?.patientId) || !isUuid(order?.addressId)) {
    return NextResponse.json({ error: "patient_id and address_id must be uuids" }, { status: 400 });
  }
  if (assignNurseId != null && !isUuid(assignNurseId)) {
    return NextResponse.json({ error: "assignNurseId must be a uuid" }, { status: 400 });
  }
  if (assignLabId != null && !isUuid(assignLabId)) {
    return NextResponse.json({ error: "assignLabId must be a uuid" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Verify patient + address belong to the chosen customer (FK guard so
  // the admin can't create an order with mismatched relations).
  const [{ data: p }, { data: a }] = await Promise.all([
    sb.from("patients").select("id, customer_id").eq("id", order.patientId).maybeSingle(),
    sb.from("addresses").select("id, customer_id").eq("id", order.addressId).maybeSingle(),
  ]);
  if (!p || p.customer_id !== customerId) {
    return NextResponse.json({ error: "patient does not belong to this customer" }, { status: 400 });
  }
  if (!a || a.customer_id !== customerId) {
    return NextResponse.json({ error: "address does not belong to this customer" }, { status: 400 });
  }

  const payload = {
    patient_id: order.patientId,
    address_id: order.addressId,
    kind: order.type,
    package_id: order.packageId ?? null,
    package_snapshot: order.packageSnapshot ?? null,
    status: tsStatusToSql(order.initialStatus),
    visit_date: order.visitDate,
    shift: order.shift,
    shift_start_time: order.shiftStartTime ?? null,
    shift_end_time: order.shiftEndTime ?? null,
    subtotal: order.subtotal,
    coupon_code: order.couponCode ?? null,
    coupon_discount: order.couponDiscount,
    total: order.total,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    prescription_url: order.prescriptionUrl ?? null,
    items: order.items.map((it, idx) => ({
      lab_test_id: it.testId,
      name_ar_snapshot: it.nameAr,
      name_en_snapshot: it.nameEn ?? null,
      price_snapshot: it.priceSnapshot,
      display_order: idx,
    })),
  };

  const { data: orderId, error: rpcErr } = await sb.rpc("place_order_admin", {
    payload,
    p_customer_id: customerId,
    idempotency_key: idempotencyKey,
  });
  if (rpcErr || !orderId) {
    console.error("[api/admin/orders] place_order_admin failed", {
      code: rpcErr?.code, message: rpcErr?.message,
      details: rpcErr?.details, hint: rpcErr?.hint, customerId,
    });
    return NextResponse.json({ error: rpcErr?.message ?? "place_order_admin returned no id" }, { status: 500 });
  }

  // Manual nurse/lab override → assign_*_admin. Otherwise auto-assign.
  if (assignNurseId) {
    const { error } = await sb.rpc("assign_nurse_admin", {
      p_order_id: orderId,
      p_nurse_id: assignNurseId,
      p_actor_role: "admin",
      p_actor_id: auth.session.userId,
      p_actor_name: auth.session.fullName ?? null,
      p_note: "manual:nurse",
    });
    if (error) console.error("[api/admin/orders] assign_nurse failed", { orderId, message: error.message });
  } else if (assignLabId) {
    // Lab is set first so auto_assign_order doesn't race the admin pick.
    const { error } = await sb.rpc("assign_lab_admin", {
      p_order_id: orderId,
      p_lab_id: assignLabId,
      p_actor_role: "admin",
      p_actor_id: auth.session.userId,
      p_actor_name: auth.session.fullName ?? null,
      p_note: "manual:lab",
    });
    if (error) console.error("[api/admin/orders] assign_lab failed", { orderId, message: error.message });
  }
  // Always run auto-assign after the manual picks; it skips already-set fields.
  const { error: autoErr } = await sb.rpc("auto_assign_order", { p_order_id: orderId });
  if (autoErr) {
    console.error("[auto-assign] (admin order) failed", { orderId, code: autoErr.code, message: autoErr.message });
  }

  const hydrated = await fetchOrderById(sb, orderId);
  if (!hydrated) {
    console.error("[api/admin/orders] place_order_admin succeeded but order could not be hydrated", { orderId, customerId });
    return NextResponse.json({ error: "تعذر تحميل بيانات الطلب بعد إنشائه", orderId }, { status: 500 });
  }
  const [enriched] = await enrichOrdersWithSignedUrls(sb, [hydrated]);
  return NextResponse.json({ order: enriched ?? hydrated, orderId } satisfies { order: Order; orderId: string });
}
