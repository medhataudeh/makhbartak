import "server-only";
import crypto from "node:crypto";

// Phase 4.3 — provider-agnostic helpers shaped around Stripe today.
// The route layer never imports stripe-node; Stripe's REST API is enough.
// Keeping the wire shapes minimal here means a future_provider can drop in
// without a fanout into business logic.

export interface StripePaymentIntent {
  id: string;
  client_secret?: string | null;
  status: string;
  amount: number;
  currency: string;
  latest_charge?: string | null;
  last_payment_error?: { message?: string; code?: string } | null;
  metadata?: Record<string, string>;
}

export interface StripeRefundedCharge {
  id: string;
  amount_refunded: number;
  currency: string;
  payment_intent?: string | null;
  refunded: boolean;
}

const STRIPE_API = "https://api.stripe.com/v1";

function secret(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

export function isStripeConfigured(): boolean {
  return !!secret();
}

// Stripe expects amounts in the currency's smallest unit. For the supported
// online currencies in our config (USD, EUR, GBP, etc.) that's cents/pence.
// SYP is hard-pinned to NOT be a Stripe currency by spec, so we never send
// SYP to Stripe; the conversion is the route's responsibility before
// calling createPaymentIntent.
function toMinorUnit(amount: number, currency: string): number {
  const ZERO_DECIMAL = new Set([
    "BIF","CLP","DJF","GNF","ISK","JPY","KMF","KRW","MGA","PYG","RWF",
    "UGX","VND","VUV","XAF","XOF","XPF",
  ]);
  if (ZERO_DECIMAL.has(currency.toUpperCase())) return Math.round(amount);
  return Math.round(amount * 100);
}

function formEncode(obj: Record<string, string | number | undefined>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}

export async function createPaymentIntent(opts: {
  chargedAmount: number;       // amount in providerCurrency major unit
  providerCurrency: string;    // e.g. "USD"
  metadata?: Record<string, string>;
  idempotencyKey: string;
}): Promise<{ ok: true; intent: StripePaymentIntent } | { ok: false; error: string; status: number }> {
  const sk = secret();
  if (!sk) return { ok: false, error: "Stripe secret key not configured", status: 500 };

  const body: Record<string, string | number | undefined> = {
    amount: toMinorUnit(opts.chargedAmount, opts.providerCurrency),
    currency: opts.providerCurrency.toLowerCase(),
    "automatic_payment_methods[enabled]": "true",
  };
  for (const [k, v] of Object.entries(opts.metadata ?? {})) {
    body[`metadata[${k}]`] = v;
  }

  const res = await fetch(`${STRIPE_API}/payment_intents`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${sk}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": opts.idempotencyKey,
    },
    body: formEncode(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      (json as { error?: { message?: string } }).error?.message ??
      `stripe http ${res.status}`;
    return { ok: false, error: errMsg, status: res.status };
  }
  return { ok: true, intent: json as unknown as StripePaymentIntent };
}

export async function retrievePaymentIntent(
  intentId: string,
): Promise<{ ok: true; intent: StripePaymentIntent } | { ok: false; error: string; status: number }> {
  const sk = secret();
  if (!sk) return { ok: false, error: "Stripe secret key not configured", status: 500 };
  const res = await fetch(`${STRIPE_API}/payment_intents/${encodeURIComponent(intentId)}`, {
    headers: { "Authorization": `Bearer ${sk}` },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, error: (json as { error?: { message?: string } }).error?.message ?? `stripe http ${res.status}`, status: res.status };
  }
  return { ok: true, intent: json as unknown as StripePaymentIntent };
}

// Webhook signature verification per https://stripe.com/docs/webhooks/signatures
// The header is e.g. "t=1700000000,v1=abc...,v1=def..."
export interface VerifyResult {
  ok: boolean;
  event?: { id: string; type: string; data: { object: Record<string, unknown> } };
  error?: string;
}

const TOLERANCE_SECONDS = 5 * 60;

export function verifyStripeSignature(payload: string, header: string | null, nowSec = Math.floor(Date.now() / 1000)): VerifyResult {
  const wh = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!wh) return { ok: false, error: "STRIPE_WEBHOOK_SECRET not configured" };
  if (!header) return { ok: false, error: "missing Stripe-Signature header" };

  const parts = header.split(",").map((s) => s.trim()).filter(Boolean);
  let timestamp: string | null = null;
  const sigs: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t") timestamp = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!timestamp || sigs.length === 0) return { ok: false, error: "malformed signature header" };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, error: "bad timestamp" };
  if (Math.abs(nowSec - tsNum) > TOLERANCE_SECONDS) return { ok: false, error: "timestamp outside tolerance" };

  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", wh).update(signed, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const matched = sigs.some((s) => {
    try {
      const sigBuf = Buffer.from(s, "hex");
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch { return false; }
  });
  if (!matched) return { ok: false, error: "signature mismatch" };

  let event: VerifyResult["event"];
  try { event = JSON.parse(payload); }
  catch { return { ok: false, error: "invalid JSON" }; }
  if (!event?.id || !event.type) return { ok: false, error: "missing id/type" };
  return { ok: true, event };
}
