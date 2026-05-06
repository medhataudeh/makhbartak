import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { verifyStripeSignature } from "@/lib/payments/stripe";

// Phase 4.3 — Stripe webhook.
//
// The webhook is the ONLY path that flips an online payment to verified.
// Frontend success callbacks are advisory.
//
// Idempotency: every event is recorded in payment_provider_events with the
// Stripe event id as primary key; INSERT … ON CONFLICT DO NOTHING short-
// circuits replays. We always return 200 once the signature is valid so
// Stripe doesn't keep retrying after our side-effects landed.
//
// Handled events:
//   payment_intent.succeeded     → confirm_online_payment_admin
//   payment_intent.payment_failed → mark_online_payment_failed
//   charge.refunded              → record_provider_refund
//
// Anything else returns 200 with `ignored: true`.

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

export async function POST(req: NextRequest) {
  // Stripe signature validation requires the raw body bytes — no JSON parse.
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  const verified = verifyStripeSignature(raw, sig);
  if (!verified.ok || !verified.event) {
    console.warn("[webhooks/stripe] signature failed", { error: verified.error });
    return NextResponse.json({ error: verified.error ?? "signature failed" }, { status: 400 });
  }
  const event = verified.event as StripeEventEnvelope;

  const sb = getSupabaseAdmin();

  // Idempotency: insert the event row first. Conflict means we've handled
  // this event already — short-circuit.
  const { error: insertErr } = await sb.from("payment_provider_events").insert({
    id:        event.id,
    provider:  "stripe",
    event_type: event.type,
    payload:   event as unknown as Record<string, unknown>,
    result:    "received",
    payment_id: null,
  });
  if (insertErr && insertErr.code !== "23505") {
    // 23505 = unique violation; anything else is a real failure.
    console.error("[webhooks/stripe] event log insert failed", { id: event.id, code: insertErr.code, message: insertErr.message });
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  if (insertErr?.code === "23505") {
    // Already processed.
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Resolve the local payment row. For payment_intent.* events the intent
  // id IS our provider_ref. For charge.refunded we read charge.payment_intent.
  const obj = event.data.object;
  const providerRef =
    event.type.startsWith("payment_intent.")
      ? (obj as IntentObject).id ?? null
      : event.type === "charge.refunded"
        ? (obj as ChargeObject).payment_intent ?? null
        : null;

  let paymentId: string | null = null;
  if (providerRef) {
    const { data: pid } = await sb.rpc("find_payment_by_provider_ref", { p_provider_ref: providerRef });
    paymentId = (pid as string | null) ?? null;
    if (paymentId) {
      await sb.from("payment_provider_events").update({ payment_id: paymentId }).eq("id", event.id);
    }
  }

  if (!paymentId) {
    console.warn("[webhooks/stripe] no matching payment row", { eventId: event.id, type: event.type, providerRef });
    await sb.from("payment_provider_events").update({ result: "no_match" }).eq("id", event.id);
    return NextResponse.json({ received: true, matched: false });
  }

  let resultTag = "ignored";
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
      console.error("[webhooks/stripe] confirm rpc failed", { paymentId, code: error.code, message: error.message });
      await sb.from("payment_provider_events").update({ result: "confirm_error" }).eq("id", event.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    resultTag = "confirmed";
  } else if (event.type === "payment_intent.payment_failed") {
    const intent = obj as IntentObject;
    const reason = intent.last_payment_error?.message ?? null;
    const { error } = await sb.rpc("mark_online_payment_failed", {
      p_payment_id: paymentId,
      p_reason:     reason,
      p_metadata:   { intent_status: intent.status ?? null, last_payment_error: intent.last_payment_error ?? null },
    });
    if (error) {
      console.error("[webhooks/stripe] failed rpc failed", { paymentId, code: error.code, message: error.message });
      await sb.from("payment_provider_events").update({ result: "failed_error" }).eq("id", event.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    resultTag = "failed";
  } else if (event.type === "charge.refunded") {
    // Stripe sends amount_refunded in minor units of the charge currency.
    // We re-derive the SYP amount via the payment row's exchange_rate so the
    // ledger stays in SYP.
    const charge = obj as ChargeObject;
    const minor = Number(charge.amount_refunded ?? 0);
    const { data: payRow } = await sb.from("payments")
      .select("amount, charged_amount, exchange_rate, provider_currency")
      .eq("id", paymentId).maybeSingle();
    const exchangeRate = Number(payRow?.exchange_rate ?? 0);
    let sypAmount = 0;
    if (charge.currency && exchangeRate > 0) {
      // minor → major in provider currency, then * exchange_rate (SYP per unit).
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
      console.error("[webhooks/stripe] refund rpc failed", { paymentId, code: error.code, message: error.message });
      await sb.from("payment_provider_events").update({ result: "refund_error" }).eq("id", event.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    resultTag = "refunded";
  }

  await sb.from("payment_provider_events").update({ result: resultTag }).eq("id", event.id);
  return NextResponse.json({ received: true, result: resultTag });
}
