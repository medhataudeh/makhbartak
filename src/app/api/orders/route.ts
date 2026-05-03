import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { fetchOrdersForAdmin, fetchOrdersForCustomer, fetchOrdersForNurse, fetchOrderById, enrichOrdersWithSignedUrls } from "@/lib/supabase/queries/orders";
import { tsStatusToSql } from "@/lib/supabase/order-status";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import type { Order, OrderStatus, PaymentMethod, Shift } from "@/lib/types";

interface CreateOrderBody {
  idempotencyKey: string;
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
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "customer") {
    return NextResponse.json({ error: "customer session required" }, { status: 403 });
  }
  const customerId = auth.session.customerId;
  if (!customerId) {
    return NextResponse.json({ error: "no customer record for this session" }, { status: 403 });
  }

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { idempotencyKey, order } = body ?? {};
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return NextResponse.json({ error: "idempotencyKey required" }, { status: 400 });
  }
  if (!isUuid(order?.patientId) || !isUuid(order?.addressId)) {
    return NextResponse.json({ error: "patient_id and address_id must be uuids that exist in supabase" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Verify patient + address belong to the authenticated customer.
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
    return NextResponse.json({ error: rpcErr?.message ?? "place_order_admin returned no id" }, { status: 500 });
  }

  // Stage A: auto-assign nurse + lab. Failures here do not block the order
  // — the row is already in `orders` and admin can assign manually later.
  const { error: autoErr } = await sb.rpc("auto_assign_order", { p_order_id: orderId });
  if (autoErr) {
    console.warn("[api/orders] auto_assign_order failed; order created without assignment", autoErr.message);
  }

  // Fetch the just-created order by its UUID via service role. This bypasses
  // any customer-scoped filter and surfaces the underlying join/select error
  // so we never return a 200 with order:null on a successful insert.
  const hydrated = await fetchOrderById(sb, orderId);
  if (!hydrated) {
    console.error("[api/orders] place_order_admin succeeded but fetchOrderById returned null", { orderId, customerId });
    return NextResponse.json(
      { error: "تم إنشاء الطلب لكن تعذر تحميل بياناته. حدّث الصفحة لعرض الطلب." },
      { status: 500 },
    );
  }
  const [enrichedOne] = await enrichOrdersWithSignedUrls(sb, [hydrated]);
  return NextResponse.json({ order: enrichedOne ?? hydrated, orderId } satisfies { order: Order; orderId: string });
}

export async function GET() {
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();

  if (auth.session.role === "admin") {
    const orders = await fetchOrdersForAdmin(sb);
    const enriched = orders ? await enrichOrdersWithSignedUrls(sb, orders) : [];
    return NextResponse.json({ orders: enriched });
  }
  if (auth.session.role === "customer") {
    if (!auth.session.customerId) {
      return NextResponse.json({ orders: [] });
    }
    const orders = await fetchOrdersForCustomer(sb, auth.session.customerId);
    const enriched = orders ? await enrichOrdersWithSignedUrls(sb, orders) : [];
    return NextResponse.json({ orders: enriched });
  }
  if (auth.session.role === "nurse") {
    if (!auth.session.nurseId) {
      return NextResponse.json({ orders: [] });
    }
    const orders = await fetchOrdersForNurse(sb, auth.session.nurseId);
    const enriched = orders ? await enrichOrdersWithSignedUrls(sb, orders) : [];
    return NextResponse.json({ orders: enriched });
  }
  if (auth.session.role === "lab") {
    if (!auth.session.labId) {
      return NextResponse.json({ orders: [] });
    }
    // Lab portal sees orders assigned to the lab.
    const { data, error } = await sb
      .from("orders").select("id").eq("lab_id", auth.session.labId).limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ orders: [] });
    const all = await fetchOrdersForAdmin(sb);
    const filtered = (all ?? []).filter((o) => o.labId === auth.session.labId);
    const enriched = await enrichOrdersWithSignedUrls(sb, filtered);
    return NextResponse.json({ orders: enriched });
  }
  return NextResponse.json({ error: "role not supported" }, { status: 403 });
}
