import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { verifyStripeSignature } from "@/lib/payments/stripe";
import { logger } from "@/lib/logger";

// Phase 4.3 + 5.1 — Stripe webhook.
//
// The webhook is the ONLY path that flips an online payment to verified.
// Frontend success callbacks are advisory.
//
// Idempotency (Phase 5.1 replay-safe):
//   * Each event row in payment_provider_events stores a `result` tag.
//   * Successful side-effects ⇒ result in {processed, confirmed, failed,
//     refunded, ignored, no_match}. A retry sees these and returns 200
//     with `duplicate: true` without re-running the side effect.
//   * Failed side-effects ⇒ result in {confirm_error, failed_error,
//     refund_error}. A Stripe retry hits the existing row, recognises an
//     "unfinished" tag, and re-runs the RPC. This closes the prior bug
//     where the event log was inserted before the side effect succeeded
//     and a retry was treated as a no-op.
//   * The 23505 unique-violation on first insert means a concurrent webhook
//     delivery is racing with us; we read the row's current result and
//     follow the same logic.
//
// Handled events:
//   payment_intent.succeeded     → confirm_online_payment_admin
//   payment_intent.payment_failed → mark_online_payment_failed
//   charge.refunded              → record_provider_refund
//
// Anything else is recorded with result='ignored' and returns 200.
//
// PR3.A — payment_provider_events bookkeeping is now routed through the
// SECURITY DEFINER `set_payment_provider_event_result(text, uuid, text)`
// RPC (mig 040) instead of direct service-role UPDATEs. External
// behavior is byte-identical: same response codes, same retry contract,
// same result tags. The INSERT (which relies on the PK 23505 collision
// for dedup) and the SELECT (which reads the existing result on replay)
// are still direct service-role calls — the trigger PR3.B will attach
// only blocks UPDATE/DELETE, not INSERT/SELECT.

export const runtime = "nodejs";

interface IntentObject {
  id?: string;
  amount?: number;
  amount_received?: number;
  currency?: string;
  status?: string;
  latest_charge?: string | null;
  last_payment_error?: { message?: string } | null;
  metadata?: Record<string, string>;
}

interface ChargeObject {
  id?: string;
  amount_refunded?: number;
  currency?: string;
  payment_intent?: string | null;
  refunded?: boolean;
  metadata?: Record<string, string>;
}

interface StripeEventEnvelope {
  id: string;
  type: string;
  data: { object: IntentObject | ChargeObject };
}

const RETRYABLE_RESULTS = new Set([
  "received", "confirm_error", "failed_error", "refund_error",
]);
const TERMINAL_RESULTS = new Set([
  "processed", "confirmed", "failed", "refunded", "ignored", "no_match", "duplicate",
]);

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  const verified = verifyStripeSignature(raw, sig);
  if (!verified.ok || !verified.event) {
    logger.warn("webhooks/stripe signature failed", {
      route: "api/webhooks/stripe",
      error: verified.error ?? "unknown",
    });
    return NextResponse.json({ error: "signature failed" }, { status: 400 });
  }
  const event = verified.event as StripeEventEnvelope;

  const sb = getSupabaseAdmin();

  // Insert-or-fetch the event row. On 23505 we look up the existing row to
  // decide whether the prior attempt finished or not.
  let priorResult: string | null = null;
  let priorPaymentId: string | null = null;
  const { error: insertErr } = await sb.from("payment_provider_events").insert({
    id:        event.id,
    provider:  "stripe",
    event_type: event.type,
    payload:   event as unknown as Record<string, unknown>,
    result:    "received",
    payment_id: null,
  });
  if (insertErr && insertErr.code !== "23505") {
    logger.error("webhooks/stripe event log insert failed", {
      route: "api/webhooks/stripe",
      eventId: event.id, code: insertErr.code,
    });
    // We don't tell Stripe to retry on infrastructure errors? Actually we
    // do — return 500 so Stripe re-delivers, since we never had a chance
    // to attempt the side effect.
    return NextResponse.json({ error: "event log insert failed" }, { status: 500 });
  }
  if (insertErr?.code === "23505") {
    const { data: existing } = await sb.from("payment_provider_events")
      .select("result, payment_id").eq("id", event.id).maybeSingle();
    priorResult    = (existing?.result as string | null) ?? null;
    priorPaymentId = (existing?.payment_id as string | null) ?? null;

    if (priorResult && TERMINAL_RESULTS.has(priorResult)) {
      // Already handled — ack the replay and bail.
      return NextResponse.json({ received: true, duplicate: true, priorResult });
    }
    // priorResult is null OR a retryable error tag — continue and re-run.
    logger.info("webhooks/stripe replay re-running", {
      route: "api/webhooks/stripe",
      eventId: event.id, priorResult,
    });
  }

  // Resolve / fast-path the payment row.
  const obj = event.data.object;
  const providerRef =
    event.type.startsWith("payment_intent.")
      ? (obj as IntentObject).id ?? null
      : event.type === "charge.refunded"
        ? (obj as ChargeObject).payment_intent ?? null
        : null;

  let paymentId: string | null = priorPaymentId;
  if (!paymentId && providerRef) {
    const { data: pid } = await sb.rpc("find_payment_by_provider_ref", { p_provider_ref: providerRef });
    paymentId = (pid as string | null) ?? null;
    if (paymentId) {
      await sb.rpc("set_payment_provider_event_result", {
        p_event_id: event.id,
        p_payment_id: paymentId,
      });
    }
  }

  if (!paymentId) {
    logger.warn("webhooks/stripe no matching payment row", {
      route: "api/webhooks/stripe",
      eventId: event.id, type: event.type, providerRef,
    });
    await sb.rpc("set_payment_provider_event_result", {
      p_event_id: event.id,
      p_result: "no_match",
    });
    return NextResponse.json({ received: true, matched: false });
  }

  // Run the side effect. On RPC failure tag the event for retry; the next
  // Stripe delivery will re-enter this branch and retry.
  if (event.type === "payment_intent.succeeded") {
    const intent = obj as IntentObject;
    const { error } = await sb.rpc("confirm_online_payment_admin", {
      p_payment_id:        paymentId,
      p_provider:          "stripe",
      p_provider_ref:      intent.id ?? providerRef ?? "",
      p_charged_amount:    typeof intent.amount_received === "number" ? intent.amount_received / 100 : null,
      p_provider_currency: intent.currency ? intent.currency.toUpperCase() : null,
      p_metadata:          { latest_charge: intent.latest_charge ?? null, intent_status: intent.status ?? null },
    });
    if (error) {
      logger.error("webhooks/stripe confirm rpc failed", {
        route: "api/webhooks/stripe",
        paymentId, code: error.code,
      });
      await sb.rpc("set_payment_provider_event_result", {
        p_event_id: event.id,
        p_result: "confirm_error",
      });
      // 5xx so Stripe retries.
      return NextResponse.json({ error: "confirm failed; will retry" }, { status: 500 });
    }
    await sb.rpc("set_payment_provider_event_result", {
      p_event_id: event.id,
      p_result: "confirmed",
    });
    return NextResponse.json({ received: true, result: "confirmed" });
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = obj as IntentObject;
    const reason = intent.last_payment_error?.message ?? null;
    const { error } = await sb.rpc("mark_online_payment_failed", {
      p_payment_id: paymentId,
      p_reason:     reason,
      p_metadata:   { intent_status: intent.status ?? null, last_payment_error: intent.last_payment_error ?? null },
    });
    if (error) {
      logger.error("webhooks/stripe failed-rpc failed", {
        route: "api/webhooks/stripe",
        paymentId, code: error.code,
      });
      await sb.rpc("set_payment_provider_event_result", {
        p_event_id: event.id,
        p_result: "failed_error",
      });
      return NextResponse.json({ error: "mark-failed failed; will retry" }, { status: 500 });
    }
    await sb.rpc("set_payment_provider_event_result", {
      p_event_id: event.id,
      p_result: "failed",
    });
    return NextResponse.json({ received: true, result: "failed" });
  }

  if (event.type === "charge.refunded") {
    const charge = obj as ChargeObject;
    const minor = Number(charge.amount_refunded ?? 0);
    const { data: payRow } = await sb.from("payments")
      .select("amount, charged_amount, exchange_rate, provider_currency")
      .eq("id", paymentId).maybeSingle();
    const exchangeRate = Number(payRow?.exchange_rate ?? 0);
    let sypAmount = 0;
    if (charge.currency && exchangeRate > 0) {
      const major = minor / 100;
      sypAmount = +(major * exchangeRate).toFixed(2);
    }
    if (!(sypAmount > 0)) sypAmount = Number(payRow?.amount ?? 0);
    const { error } = await sb.rpc("record_provider_refund", {
      p_payment_id: paymentId,
      p_amount:     sypAmount,
      p_reason:     "Stripe refund",
      p_metadata:   { charge_id: charge.id ?? null, amount_refunded_minor: minor, currency: charge.currency ?? null },
    });
    if (error) {
      logger.error("webhooks/stripe refund-rpc failed", {
        route: "api/webhooks/stripe",
        paymentId, code: error.code,
      });
      await sb.rpc("set_payment_provider_event_result", {
        p_event_id: event.id,
        p_result: "refund_error",
      });
      return NextResponse.json({ error: "refund failed; will retry" }, { status: 500 });
    }
    await sb.rpc("set_payment_provider_event_result", {
      p_event_id: event.id,
      p_result: "refunded",
    });
    return NextResponse.json({ received: true, result: "refunded" });
  }

  // Unknown event type — record and ack.
  await sb.rpc("set_payment_provider_event_result", {
    p_event_id: event.id,
    p_result: "ignored",
  });
  return NextResponse.json({ received: true, result: "ignored" });
}
// Suppress unused warning if a future tag list is referenced elsewhere.
void RETRYABLE_RESULTS;
