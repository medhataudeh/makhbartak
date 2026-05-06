import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { createPaymentIntent, isStripeConfigured } from "@/lib/payments/stripe";

// Phase 4.3 — customer-facing create-intent for online checkout.
//
// Hard contract:
//   * Customer-only. Order must belong to caller.
//   * Order must be `online` and unpaid.
//   * Stripe must be enabled (app_settings.enable_stripe = true).
//   * The route does NOT mark the order paid. The webhook is the only path
//     that can flip orders.payment_status='paid'.
//   * Conversion SYP → provider currency happens here using two env vars
//     so admin doesn't accidentally toggle live exchange rates from the UI:
//       STRIPE_ONLINE_CURRENCY              (default "USD")
//       STRIPE_SYP_PER_PROVIDER_UNIT        (e.g. "13000" — 1 USD = 13000 SYP)
//     If the rate is not configured, the route refuses with Arabic copy so
//     ops sees the failure clearly.

interface Body { orderId: string }

function pickProviderCurrency(): string {
  const c = process.env.STRIPE_ONLINE_CURRENCY?.trim().toUpperCase();
  return c && /^[A-Z]{3}$/.test(c) ? c : "USD";
}

function pickRateSypPerUnit(): number | null {
  const raw = process.env.STRIPE_SYP_PER_PROVIDER_UNIT?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "customer" || !auth.session.customerId) {
    return NextResponse.json({ error: "هذه العملية متاحة للعميل فقط" }, { status: 403 });
  }

  let body: Body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { orderId } = body ?? ({} as Body);
  if (!orderId || !isUuid(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "خدمة الدفع الإلكتروني غير مهيّأة على الخادم" }, { status: 500 });
  }

  const sb = getSupabaseAdmin();

  // Settings + order state. Also pull the existing pending payment row to
  // short-circuit duplicate-intent calls (the customer hits "Pay" twice).
  const [settingsRes, orderRes, payRes] = await Promise.all([
    sb.from("app_settings")
      .select("enable_stripe").eq("id", 1).maybeSingle(),
    sb.from("orders")
      .select("id, customer_id, payment_method, payment_status, total, public_number")
      .eq("id", orderId).maybeSingle(),
    sb.from("payments")
      .select("id, provider, provider_ref, provider_metadata, status")
      .eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (!settingsRes.data?.enable_stripe) {
    return NextResponse.json({ error: "الدفع الإلكتروني غير مفعّل حالياً" }, { status: 409 });
  }
  if (orderRes.error) {
    return NextResponse.json({ error: "تعذر قراءة الطلب من قاعدة البيانات" }, { status: 500 });
  }
  const order = orderRes.data;
  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
  if (order.customer_id !== auth.session.customerId) {
    return NextResponse.json({ error: "الطلب غير مرتبط بهذا الحساب" }, { status: 403 });
  }
  if (order.payment_method !== "online") {
    return NextResponse.json({ error: "هذا الطلب نقدي وليس إلكترونياً" }, { status: 409 });
  }
  if (order.payment_status === "paid") {
    return NextResponse.json({ error: "تم دفع الطلب مسبقاً" }, { status: 409 });
  }

  // Already created an intent for this order — return its client_secret so
  // the customer's retry hits the same Stripe object.
  type ExistingPay = {
    id: string; provider: string | null; provider_ref: string | null;
    provider_metadata: { client_secret?: string } | null; status: string;
  };
  const existing = (payRes.data as ExistingPay | null) ?? null;
  if (existing && existing.provider === "stripe" && existing.provider_ref && existing.status === "pending") {
    const cs = existing.provider_metadata?.client_secret ?? null;
    if (cs) {
      return NextResponse.json({
        paymentId: existing.id,
        intentId: existing.provider_ref,
        clientSecret: cs,
        provider: "stripe",
        reused: true,
      });
    }
  }

  // Conversion. SYP → provider currency.
  const providerCurrency = pickProviderCurrency();
  const rate = pickRateSypPerUnit();
  if (!rate) {
    return NextResponse.json(
      { error: "سعر صرف الدفع الإلكتروني غير مهيّأ على الخادم" },
      { status: 500 },
    );
  }
  const totalSyp = Number(order.total ?? 0);
  if (!(totalSyp > 0)) {
    return NextResponse.json({ error: "قيمة الطلب غير صالحة" }, { status: 409 });
  }
  const chargedAmount = +(totalSyp / rate).toFixed(2);
  if (!(chargedAmount > 0)) {
    return NextResponse.json({ error: "قيمة الطلب الناتجة عن التحويل غير صالحة" }, { status: 500 });
  }

  // Create the intent on Stripe. Idempotency keyed on order — Stripe will
  // return the same object on retry.
  const created = await createPaymentIntent({
    chargedAmount,
    providerCurrency,
    metadata: {
      makhbartak_order_id: order.id,
      makhbartak_public_number: order.public_number ?? "",
      makhbartak_amount_syp: String(totalSyp),
    },
    idempotencyKey: `mk_intent_${order.id}`,
  });
  if (!created.ok) {
    console.error("[create-intent] stripe failed", { orderId, error: created.error });
    return NextResponse.json({ error: "تعذر إنشاء الدفع الإلكتروني، حاول مرة أخرى" }, { status: 502 });
  }
  const intent = created.intent;

  // Persist provider snapshot on the payments row. RPC handles "no pending
  // row" gracefully.
  const { data: paymentId, error: rpcErr } = await sb.rpc("start_online_payment_admin", {
    p_order_id:          order.id,
    p_customer_id:       auth.session.customerId,
    p_provider:          "stripe",
    p_provider_ref:      intent.id,
    p_charged_amount:    chargedAmount,
    p_provider_currency: providerCurrency,
    p_exchange_rate:     rate,
    p_metadata:          { client_secret: intent.client_secret ?? null, intent_status: intent.status },
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "تعذر تسجيل الدفع";
    const isBusiness = typeof msg === "string" && (
      msg.includes("الطلب غير موجود") ||
      msg.includes("غير مرتبط") ||
      msg.includes("الإلكترونية") ||
      msg.includes("مسبقاً")
    );
    if (isBusiness) return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[create-intent] rpc failed", { orderId, code: rpcErr.code, message: msg });
    return NextResponse.json({ error: "تعذر حفظ سجل الدفع، حاول مرة أخرى" }, { status: 500 });
  }

  return NextResponse.json({
    paymentId: paymentId,
    intentId: intent.id,
    clientSecret: intent.client_secret ?? null,
    provider: "stripe",
    providerCurrency,
    chargedAmount,
    amountSyp: totalSyp,
    exchangeRate: rate,
    reused: false,
  });
}
