import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { fetchOrdersForAdmin, fetchOrdersForCustomer, fetchOrdersForNurse, enrichOrdersWithSignedUrls } from "@/lib/supabase/queries/orders";
import { tsStatusToSql } from "@/lib/supabase/order-status";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession, Order, OrderStatus, PaymentMethod, Shift } from "@/lib/types";

// Phase 1: trust the mock session passed by the client (mock auth has no
// stronger boundary than this — same trust level as today's localStorage).
// When real Supabase Auth lands, this trust is replaced by an auth-cookie
// check and these routes shrink to passthroughs or are removed.

interface CreateOrderBody {
  session: AuthSession;
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
  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, idempotencyKey, order } = body ?? {};
  if (!session || session.role !== "customer") {
    return NextResponse.json({ error: "customer session required" }, { status: 403 });
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return NextResponse.json({ error: "idempotencyKey required" }, { status: 400 });
  }
  const customerId = session.linkedEntityId;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "session.linkedEntityId is not a uuid; reseed Phase 1 demo data" }, { status: 400 });
  }
  if (!isUuid(order.patientId) || !isUuid(order.addressId)) {
    return NextResponse.json({ error: "patient_id and address_id must be uuids that exist in supabase" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Verify the customer row exists (deterministic 403 vs cryptic FK error).
  const { data: c, error: cErr } = await sb
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!c) {
    return NextResponse.json({ error: "customer not found in supabase; run migration 010" }, { status: 404 });
  }

  // Verify patient + address belong to this customer.
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

  // public_number is generated server-side by the RPC (migration 011) and any
  // value the client sends is intentionally ignored to prevent collisions
  // after a localStorage reset.
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

  // Hydrate the row so the client gets a full TS Order back. Falls back to
  // a minimal stub if the read fails (rare; the row was just inserted).
  const orders = await fetchOrdersForCustomer(sb, customerId);
  const enriched = orders ? await enrichOrdersWithSignedUrls(sb, orders) : [];
  const created = enriched.find((o) => o.id === orderId) ?? null;
  return NextResponse.json({ order: created, orderId } satisfies { order: Order | null; orderId: string });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  const customerId = url.searchParams.get("customerId");
  const nurseId = url.searchParams.get("nurseId");
  const sb = getSupabaseAdmin();

  if (role === "admin") {
    const orders = await fetchOrdersForAdmin(sb);
    const enriched = orders ? await enrichOrdersWithSignedUrls(sb, orders) : [];
    return NextResponse.json({ orders: enriched });
  }
  if (role === "customer") {
    if (!customerId || !isUuid(customerId)) {
      return NextResponse.json({ error: "customerId uuid required for customer role" }, { status: 400 });
    }
    const orders = await fetchOrdersForCustomer(sb, customerId);
    const enriched = orders ? await enrichOrdersWithSignedUrls(sb, orders) : [];
    return NextResponse.json({ orders: enriched });
  }
  if (role === "nurse") {
    if (!nurseId || !isUuid(nurseId)) {
      return NextResponse.json({ error: "nurseId uuid required for nurse role" }, { status: 400 });
    }
    const orders = await fetchOrdersForNurse(sb, nurseId);
    const enriched = orders ? await enrichOrdersWithSignedUrls(sb, orders) : [];
    return NextResponse.json({ orders: enriched });
  }
  return NextResponse.json({ error: "role must be 'customer', 'admin', or 'nurse'" }, { status: 400 });
}
