"use client";
import { useSyncExternalStore } from "react";
import type { ActivityLog, ActivityAction, AdminRole } from "./types";
import { MOCK_ACTIVITY_LOGS } from "./mock-data";

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
}

export function useActivityLogs(): ActivityLog[] {
  return useSyncExternalStore(subscribe, getActivityLogs, () => MOCK_ACTIVITY_LOGS);
}
