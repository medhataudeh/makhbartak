"use client";
import type { Order, OrderStatus, PaymentMethod, Shift } from "@/lib/types";

// Thin client-side fetch wrappers around /api/orders. They translate between
// the TS Order shape and the JSON the route handlers expect. Auth comes from
// the Supabase cookie set by middleware; routes call requireAuthedUser.

export interface ApiCreateOrderInput {
  type: "package" | "custom" | "prescription";
  packageId?: string;
  packageSnapshot?: unknown;
  items: Array<{ testId: string; nameAr: string; nameEn?: string; priceSnapshot: number }>;
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
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  initialStatus: OrderStatus;
  /** Storage path returned by /api/customers/[id]/prescriptions when type === "prescription". */
  prescriptionUrl?: string;
}

export async function apiCreateOrder(
  idempotencyKey: string,
  order: ApiCreateOrderInput,
): Promise<{ order: Order; orderId: string } | { error: string }> {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey, order }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: body.error ?? `HTTP ${res.status}` };
  if (!body.order) return { error: body.error ?? "تعذر تحميل بيانات الطلب بعد إنشائه" };
  return { order: body.order as Order, orderId: body.orderId as string };
}

export async function apiListOrdersForCustomer(customerId: string): Promise<Order[] | null> {
  const res = await fetch(`/api/orders?role=customer&customerId=${encodeURIComponent(customerId)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return (body?.orders ?? null) as Order[] | null;
}

export async function apiListOrdersForAdmin(): Promise<Order[] | null> {
  const res = await fetch("/api/orders?role=admin", { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return (body?.orders ?? null) as Order[] | null;
}

export async function apiListOrdersForNurse(nurseId: string): Promise<Order[] | null> {
  const res = await fetch(`/api/orders?role=nurse&nurseId=${encodeURIComponent(nurseId)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return (body?.orders ?? null) as Order[] | null;
}

// Lab portal hydration. The server's GET /api/orders handler routes by
// `auth.session.role`; for a lab session it filters orders by
// `lab_id === session.labId` server-side. The labId in the URL is for
// telemetry/consistency only — the server does not trust it.
export async function apiListOrdersForLab(labId: string): Promise<Order[] | null> {
  const res = await fetch(`/api/orders?role=lab&labId=${encodeURIComponent(labId)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return (body?.orders ?? null) as Order[] | null;
}

export async function apiAssignNurse(
  orderId: string,
  nurseId: string | null,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/assign-nurse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nurseId, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiAssignLab(
  orderId: string,
  labId: string | null,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/assign-lab`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ labId, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiUploadLabResultFile(
  orderId: string,
  file: File,
  opts?: { fileName?: string; replacesFileId?: string; note?: string },
): Promise<{ order: Order | null; fileId: string } | { error: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("fileName", opts?.fileName ?? file.name);
  if (opts?.replacesFileId) fd.append("replacesFileId", opts.replacesFileId);
  if (opts?.note) fd.append("note", opts.note);
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/lab/files`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiArchiveLabResultFile(
  orderId: string,
  fileId: string,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/lab/files/${encodeURIComponent(fileId)}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiConfirmLabResults(
  orderId: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/lab/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiAddOrderNote(
  orderId: string,
  text: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiApplyCoupon(
  orderId: string,
  couponCode: string | null,
  couponDiscount: number,
  total: number,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/coupon`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ couponCode, couponDiscount, total }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiSetPaymentStatus(
  orderId: string,
  paymentStatus: "pending" | "paid" | "failed" | "refunded",
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment-status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentStatus, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

// Phase 4.1 — atomic cash collection for the nurse. Hits the new
// /cash-collected route which writes the canonical paid payment row, flips
// orders.payment_status, and credits the nurse wallet in a single RPC.
export async function apiCollectCash(
  orderId: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cash-collected`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

// Phase 4.4 — fetch the current payment lifecycle state for the customer
// payment page poller. Customer-self or admin.
export interface OrderPaymentState {
  order: { id: string; paymentMethod: "cash" | "online"; paymentStatus: string; total: number };
  payment: {
    id: string;
    status: string;
    method: string;
    amount: number;
    currency: string;
    provider: string | null;
    providerRef: string | null;
    chargedAmount: number | null;
    providerCurrency: string | null;
    exchangeRate: number | null;
    paidAt: string | null;
    refundedAmount: number;
  } | null;
}

export async function apiGetOrderPaymentState(
  orderId: string,
): Promise<{ ok: true; state: OrderPaymentState } | { ok: false; error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment-status`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
  }
  const json = (await res.json()) as OrderPaymentState;
  return { ok: true, state: json };
}

// Phase 4.4 — create or reuse a Stripe PaymentIntent for an online order.
// The route is idempotent on the order id (Stripe-side) and the wallet row
// (DB-side); duplicate calls return the same client_secret.
export interface CreateIntentResult {
  paymentId: string;
  intentId: string;
  clientSecret: string | null;
  provider: "stripe";
  providerCurrency?: string;
  chargedAmount?: number;
  amountSyp?: number;
  exchangeRate?: number;
  reused?: boolean;
}

export async function apiCreateStripeIntent(
  orderId: string,
): Promise<{ ok: true; intent: CreateIntentResult } | { ok: false; error: string }> {
  const res = await fetch(`/api/payments/stripe/create-intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
  }
  return { ok: true, intent: (await res.json()) as CreateIntentResult };
}

// Phase 4.1.1 — admin office-collection. Same on-ledger contract as
// apiCollectCash; the RPC writes the paid payment row + history + (if a
// nurse is assigned) wallet credit in one transaction.
export async function apiAdminRecordCashPayment(
  orderId: string,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/record-cash-payment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiCancelOrder(
  orderId: string,
  reason?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiRescheduleOrder(
  orderId: string,
  visitDate: string,
  shift: import("@/lib/types").Shift,
  shiftStartTime?: string,
  shiftEndTime?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/reschedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitDate, shift, shiftStartTime, shiftEndTime }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiVerifyPatient(
  orderId: string,
  officialName: string,
  nationalId?: string,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/verify-patient`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ officialName, nationalId, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiForceCompleteOrder(
  orderId: string,
  reason: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/force-complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiSetOrderStatus(
  orderId: string,
  status: import("@/lib/types").OrderStatus,
  opts?: { note?: string; reason?: string },
): Promise<{ order: Order } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, note: opts?.note, reason: opts?.reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiGetOrder(id: string): Promise<Order | null> {
  const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return (body?.order ?? null) as Order | null;
}
