import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { fetchOrdersForAdmin, fetchOrdersForCustomer, fetchOrdersForNurse, fetchOrderById, enrichOrdersWithSignedUrls } from "@/lib/supabase/queries/orders";
import { tsStatusToSql } from "@/lib/supabase/order-status";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { logger } from "@/lib/logger";
import { validateCouponServer } from "@/lib/server/coupons";
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
    /** Storage path returned by the prescriptions upload route. */
    prescriptionUrl?: string;
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

  // ── Server-authoritative pricing ────────────────────────────────────────
  // Money math is server-only (CLAUDE.md "Financial Calculation Ownership").
  // The client-supplied subtotal / coupon_discount / total / price_snapshot
  // are advisory; we recompute every figure from the catalog and re-validate
  // the coupon against canonical rows. Mismatches do not error — the server
  // value wins. payment_status is always seeded "pending"; cash flips via
  // /cash-collected, online flips via the Stripe webhook.
  const items = Array.isArray(order.items) ? order.items : [];
  const testIds = Array.from(
    new Set(items.map((i) => i?.testId).filter((x): x is string => isUuid(x ?? ""))),
  );

  const priceById = new Map<string, { sellPrice: number; nameAr: string; nameEn: string | null }>();
  if (testIds.length) {
    const { data: tests, error: testsErr } = await sb
      .from("lab_tests")
      .select("id, sell_price, name_ar, name_en, is_active")
      .in("id", testIds);
    if (testsErr) {
      logger.error("orders POST: lab_tests fetch failed", { route: "api/orders", code: testsErr.code });
      return NextResponse.json({ error: "تعذر التحقق من قائمة الفحوصات" }, { status: 500 });
    }
    for (const t of tests ?? []) {
      if (t.is_active === false) continue;
      priceById.set(t.id as string, {
        sellPrice: Number(t.sell_price ?? 0),
        nameAr: (t.name_ar as string) ?? "",
        nameEn: (t.name_en as string | null) ?? null,
      });
    }
  }

  let serverSubtotal = 0;
  let serverItems: Array<{ testId: string; nameAr: string; nameEn: string | null; priceSnapshot: number }> = [];

  if (order.type === "package") {
    if (!order.packageId || !isUuid(order.packageId)) {
      return NextResponse.json({ error: "معرف الباقة غير صالح" }, { status: 400 });
    }
    const { data: pkg, error: pkgErr } = await sb
      .from("packages")
      .select("id, price, is_active")
      .eq("id", order.packageId)
      .maybeSingle();
    if (pkgErr) {
      logger.error("orders POST: package fetch failed", { route: "api/orders", code: pkgErr.code });
      return NextResponse.json({ error: "تعذر التحقق من الباقة" }, { status: 500 });
    }
    if (!pkg || pkg.is_active === false) {
      return NextResponse.json({ error: "الباقة غير متاحة" }, { status: 400 });
    }
    serverSubtotal = Number(pkg.price ?? 0);
    // Items are operational (admin/nurse/lab see contents); price_snapshot
    // reflects the per-test catalog price for record-keeping. They do NOT sum
    // to subtotal — package pricing is set at the package row.
    serverItems = items.map((it) => {
      const canonical = priceById.get(it.testId);
      return {
        testId: it.testId,
        nameAr: canonical?.nameAr ?? it.nameAr ?? "",
        nameEn: canonical?.nameEn ?? it.nameEn ?? null,
        priceSnapshot: canonical?.sellPrice ?? 0,
      };
    });
  } else {
    // custom / prescription: line items sum to subtotal at canonical prices.
    serverItems = items.map((it) => {
      const canonical = priceById.get(it.testId);
      return {
        testId: it.testId,
        nameAr: canonical?.nameAr ?? it.nameAr ?? "",
        nameEn: canonical?.nameEn ?? it.nameEn ?? null,
        priceSnapshot: canonical?.sellPrice ?? 0,
      };
    });
    if (serverItems.some((i) => !(i.priceSnapshot > 0))) {
      return NextResponse.json({ error: "أحد الفحوصات غير متاح أو لا يحمل سعراً صالحاً" }, { status: 400 });
    }
    serverSubtotal = serverItems.reduce((s, i) => s + i.priceSnapshot, 0);
  }

  // Coupon re-validation through the shared SSoT module
  // (`validateCouponServer`). Same authoritative pricing rules as the
  // public preview at /api/coupons/validate. Silent drop on invalid
  // coupons (and on transient DB read errors) is preserved per the C1
  // audit: the cart-time preview already validated; if the coupon flips
  // invalid between cart and submit, the order is placed at full subtotal.
  let serverCouponCode: string | null = null;
  let serverCouponDiscount = 0;
  if (order.couponCode) {
    try {
      const couponResult = await validateCouponServer(sb, order.couponCode, serverSubtotal);
      if (couponResult.valid) {
        serverCouponCode = couponResult.code;
        serverCouponDiscount = couponResult.discount;
      }
      // invalid → silently drop (preserves prior behavior).
    } catch (err) {
      logger.warn("orders POST: coupon validation threw; silently dropping", {
        route: "api/orders",
        error: err instanceof Error ? err.message : String(err),
      });
      // DB error → silent drop, matching the prior behavior where a null
      // data shape from the SELECT was indistinguishable from "not found".
    }
  }

  const serverTotal = Math.max(0, serverSubtotal - serverCouponDiscount);

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
    subtotal: serverSubtotal,
    coupon_code: serverCouponCode,
    coupon_discount: serverCouponDiscount,
    total: serverTotal,
    payment_method: order.paymentMethod,
    payment_status: "pending",
    prescription_url: order.prescriptionUrl ?? null,
    items: serverItems.map((it, idx) => ({
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
    console.error("[api/orders] place_order_admin failed", {
      code: rpcErr?.code, message: rpcErr?.message,
      details: rpcErr?.details, hint: rpcErr?.hint, customerId,
    });
    return NextResponse.json({ error: rpcErr?.message ?? "place_order_admin returned no id" }, { status: 500 });
  }

  // Phase 3.5 — controlled auto-assignment (Fix 2). The
  // `auto_assign_order` RPC (migration 014) picks a nurse + lab from the
  // real DB only:
  //   * Nurse  : same-city active nurse with the lightest load on the
  //              order's (visit_date, shift); falls back to any active
  //              nurse, ranked the same way. Pure DB read; no MOCK ids.
  //   * Lab    : active lab whose `supported_cities` covers the order's
  //              city; falls back to active lab in the same city; final
  //              fallback to any active lab.
  // Both arms validate ids exist via assign_*_admin internally. If neither
  // a nurse nor a lab can be picked the row stays unassigned and admin
  // can still set it manually — order creation is not blocked.
  const { data: assigned, error: autoErr } = await sb.rpc("auto_assign_order", { p_order_id: orderId });
  if (autoErr) {
    logger.error("auto-assign failed", {
      route: "api/orders",
      orderId, code: autoErr.code,
    });
  } else {
    const row = Array.isArray(assigned) ? assigned[0] : assigned;
    logger.info("auto-assign", {
      route: "api/orders",
      orderId,
      nurseId: row?.nurse_id ?? null,
      labId: row?.lab_id ?? null,
    });
  }

  // Fetch the just-created order by its UUID via service role. fetchOrderById
  // already retries with a bare select if the embedded select errors, so a
  // null here means the row genuinely cannot be read — surface that to the
  // client instead of pretending the create succeeded.
  const hydrated = await fetchOrderById(sb, orderId);
  if (!hydrated) {
    console.error("[api/orders] place_order_admin succeeded but order could not be hydrated", { orderId, customerId });
    return NextResponse.json(
      {
        error: "تعذر تحميل بيانات الطلب بعد إنشائه. حاول مرة أخرى أو راجع الدعم.",
        orderId,
      },
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
