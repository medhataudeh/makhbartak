"use client";
import type { AuthSession, Order, OrderStatus, PaymentMethod, Shift } from "@/lib/types";

// Thin client-side fetch wrappers around /api/orders. They translate between
// the TS Order shape and the JSON the route handlers expect.

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
  paymentStatus: "pending" | "paid" | "failed";
  initialStatus: OrderStatus;
}

export async function apiCreateOrder(
  session: AuthSession,
  idempotencyKey: string,
  order: ApiCreateOrderInput,
): Promise<{ order: Order | null; orderId: string } | { error: string }> {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, idempotencyKey, order }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
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

export async function apiAssignNurse(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  nurseId: string | null,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/assign-nurse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, nurseId, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiAssignLab(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  labId: string | null,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/assign-lab`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, labId, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiUploadLabResultFile(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  file: File,
  opts?: { fileName?: string; replacesFileId?: string; note?: string },
): Promise<{ order: Order | null; fileId: string } | { error: string }> {
  const fd = new FormData();
  fd.append("session", JSON.stringify(session));
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
  session: import("@/lib/types").AuthSession,
  orderId: string,
  fileId: string,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/lab/files/${encodeURIComponent(fileId)}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiConfirmLabResults(
  session: import("@/lib/types").AuthSession,
  orderId: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/lab/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiAddOrderNote(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  text: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiApplyCoupon(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  couponCode: string | null,
  couponDiscount: number,
  total: number,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/coupon`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, couponCode, couponDiscount, total }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiSetPaymentStatus(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  paymentStatus: "pending" | "paid" | "failed" | "refunded",
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment-status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, paymentStatus, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiCancelOrder(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  reason?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiRescheduleOrder(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  visitDate: string,
  shift: import("@/lib/types").Shift,
  shiftStartTime?: string,
  shiftEndTime?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/reschedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, visitDate, shift, shiftStartTime, shiftEndTime }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiVerifyPatient(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  officialName: string,
  nationalId?: string,
  note?: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/verify-patient`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, officialName, nationalId, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiForceCompleteOrder(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  reason: string,
): Promise<{ order: Order | null } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/force-complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiSetOrderStatus(
  session: import("@/lib/types").AuthSession,
  orderId: string,
  status: import("@/lib/types").OrderStatus,
  opts?: { note?: string; reason?: string },
): Promise<{ order: Order } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, status, note: opts?.note, reason: opts?.reason }),
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
