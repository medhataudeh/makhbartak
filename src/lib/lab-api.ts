"use client";
import type { AuthSession, LabIssueType, Order } from "@/lib/types";

export async function apiOpenLabIssue(
  session: AuthSession,
  orderId: string,
  payload: { type: LabIssueType; description: string; customerMessageAr?: string },
): Promise<{ order: Order | null; issueId: string } | { error: string }> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/lab-issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, ...payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

export async function apiUpdateLabIssueMessage(
  session: AuthSession,
  issueId: string,
  customerMessageAr: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/lab-issues/${encodeURIComponent(issueId)}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, customerMessageAr }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function apiResolveLabIssue(
  session: AuthSession,
  issueId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/lab-issues/${encodeURIComponent(issueId)}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, note }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function apiPatchLab(
  session: AuthSession,
  labId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; lab?: unknown }> {
  const res = await fetch(`/api/labs/${encodeURIComponent(labId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, patch }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: true, lab: json.lab };
}

export interface RawSettlementRow {
  id: string;
  lab_id: string;
  period_start: string;
  period_end: string;
  total_orders: number;
  total_lab_amount: number;
  total_paid: number;
  status: "pending" | "partially_paid" | "paid";
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: Array<{ id: string; order_id: string; lab_amount: number; status: string }>;
}

export async function apiListSettlements(labId: string): Promise<RawSettlementRow[] | null> {
  const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/settlements`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.settlements) ? body.settlements : null;
}

export async function apiGenerateSettlement(
  session: AuthSession,
  labId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ ok: boolean; error?: string; settlementId?: string }> {
  const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/settlements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, periodStart, periodEnd }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { ok: true, settlementId: body.settlementId };
}

export async function apiSetSettlementStatus(
  session: AuthSession,
  settlementId: string,
  status: "pending" | "partially_paid" | "paid",
  totalPaid?: number,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/settlements/${encodeURIComponent(settlementId)}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session, status, totalPaid }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}
