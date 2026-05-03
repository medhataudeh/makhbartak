"use client";
import { useSyncExternalStore } from "react";
import type { ActivityLog, ActivityAction, AdminRole } from "./types";
import { MOCK_ACTIVITY_LOGS } from "./mock-data";
import { USE_SUPABASE } from "./supabase/flags";

let _logs: ActivityLog[] = [...MOCK_ACTIVITY_LOGS];
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function getActivityLogs(): ActivityLog[] { return _logs; }

interface LogInput {
  adminId: string;
  adminName: string;
  role: AdminRole;
  action: ActivityAction;
  entity: string;
  entityId: string;
  details: string;
}

export function logActivity(input: LogInput): void {
  const entry: ActivityLog = {
    id: `al-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    ...input,
    createdAt: new Date().toISOString(),
  };
  _logs = [entry, ..._logs];
  emit();
  void persistActivityLogViaApi(input);
}

async function persistActivityLogViaApi(input: LogInput): Promise<void> {
  if (!USE_SUPABASE) return;
  const session = (await import("./auth")).getStoredSession();
  if (!session || session.role !== "admin") return;
  try {
    await fetch("/api/admin/activity-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details: input.details,
      }),
    });
  } catch (err) {
    console.warn("[api/admin/activity-logs] failed; keeping local entry", err);
  }
}

interface RawActivityRow {
  id: string;
  admin_id: string | null;
  admin_name: string | null;
  role: AdminRole | null;
  action: ActivityAction;
  entity: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
}

export async function hydrateActivityLogs(): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    const res = await fetch("/api/admin/activity-logs?limit=200", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    if (!body || !Array.isArray(body.logs)) return;
    const remote: ActivityLog[] = (body.logs as RawActivityRow[]).map((r) => ({
      id: r.id,
      adminId: r.admin_id ?? "—",
      adminName: r.admin_name ?? "—",
      role: (r.role as AdminRole) ?? "super_admin",
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id ?? "",
      details: r.details ?? "",
      createdAt: r.created_at,
    }));
    const byId = new Map(_logs.map((x) => [x.id, x]));
    for (const e of remote) byId.set(e.id, e);
    _logs = Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    emit();
  } catch (err) {
    console.warn("[api/admin/activity-logs] hydrate failed", err);
  }
}

export function useActivityLogs(): ActivityLog[] {
  return useSyncExternalStore(subscribe, getActivityLogs, () => MOCK_ACTIVITY_LOGS);
}
