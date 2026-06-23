"use client";

export async function apiUpdateNurseProfile(
  nurseId: string,
  patch: { name?: string; city?: string; photoUrl?: string },
): Promise<{ ok: boolean; error?: string; nurse?: unknown }> {
  const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: true, nurse: json.nurse };
}

export interface NursePrep {
  nurseId: string;
  day: string;
  started: boolean;
  checkedIds: string[];
}

export async function apiGetNursePrep(
  nurseId: string,
  day: string,
): Promise<NursePrep | null> {
  const res = await fetch(
    `/api/nurses/${encodeURIComponent(nurseId)}/prep?day=${encodeURIComponent(day)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body?.prep) return null;
  return {
    nurseId: body.prep.nurse_id,
    day: body.prep.day,
    started: !!body.prep.started,
    checkedIds: Array.isArray(body.prep.checked_ids) ? body.prep.checked_ids : [],
  };
}

export async function apiSetNursePrep(
  nurseId: string,
  day: string,
  patch: { started: boolean; checkedIds: string[] },
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/prep`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ day, started: patch.started, checkedIds: patch.checkedIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

// ─── Daily prep confirmation (server-side day-start gate) ──────────────────
export interface NursePrepConfirmation {
  nurseId: string;
  workDate: string;
  confirmedAt: string;
  confirmedItems: string[];
}

export async function apiGetPrepConfirmation(
  nurseId: string,
  workDate: string,
): Promise<NursePrepConfirmation | null> {
  const res = await fetch(
    `/api/nurses/${encodeURIComponent(nurseId)}/prep-confirmation?day=${encodeURIComponent(workDate)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const c = body?.confirmation;
  if (!c) return null;
  return {
    nurseId: c.nurse_id,
    workDate: c.work_date,
    confirmedAt: c.confirmed_at,
    confirmedItems: Array.isArray(c.confirmed_items) ? c.confirmed_items : [],
  };
}

export async function apiConfirmPrep(
  nurseId: string,
  workDate: string,
  confirmedItems: string[],
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/prep-confirmation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workDate, confirmedItems }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export interface NurseShortageRequest {
  id: string;
  nurseId: string;
  nurseName: string | null;
  day: string;
  note: string | null;
  status: "pending" | "acknowledged" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  resolvedByAdminName: string | null;
  items: Array<{ id: string; toolId: string | null; nameSnapshot: string; quantity: number }>;
}

interface RawShortageRow {
  id: string;
  nurse_id: string;
  nurse_name: string | null;
  day: string;
  note: string | null;
  status: NurseShortageRequest["status"];
  created_at: string;
  resolved_at: string | null;
  resolved_by_admin_name: string | null;
  items: Array<{ id: string; tool_id: string | null; name_snapshot: string; quantity: number }>;
}

function mapShortageRow(r: RawShortageRow): NurseShortageRequest {
  return {
    id: r.id,
    nurseId: r.nurse_id,
    nurseName: r.nurse_name,
    day: r.day,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedByAdminName: r.resolved_by_admin_name,
    items: (r.items ?? []).map((it) => ({
      id: it.id,
      toolId: it.tool_id,
      nameSnapshot: it.name_snapshot,
      quantity: it.quantity,
    })),
  };
}

export async function apiListShortageRequests(nurseId: string): Promise<NurseShortageRequest[] | null> {
  const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/shortage-requests`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.requests) ? body.requests.map(mapShortageRow) : null;
}

export async function apiSubmitShortageRequest(
  nurseId: string,
  payload: {
    day?: string;
    note?: string;
    items: Array<{ toolId?: string | null; nameSnapshot: string; quantity?: number }>;
  },
): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/shortage-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { ok: true, requestId: body.requestId };
}

export async function apiSetShortageRequestStatus(
  requestId: string,
  status: "pending" | "acknowledged" | "resolved",
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/shortage-requests/${encodeURIComponent(requestId)}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}
