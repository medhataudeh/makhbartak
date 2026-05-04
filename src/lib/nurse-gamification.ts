"use client";
import { useEffect, useState } from "react";
import type { NurseGamification, NurseLevel } from "./types";
import { NURSE_LEVELS } from "./mock-data";
import { isUuid } from "./supabase/uuid";
import { USE_SUPABASE } from "./supabase/flags";

// Phase 1: nurse_gamification rows live in Supabase. The level catalog and
// badge catalog stay client-side (NURSE_LEVELS / NURSE_BADGES) for now —
// admin CRUD for those is a later-phase ticket. We resolve the row's
// level_id back to a NurseLevel via NURSE_LEVELS so the rest of the UI
// keeps working unchanged.

interface RawGamificationRow {
  nurse_id: string;
  total_completed: number;
  total_points: number;
  points_today: number;
  monthly_completed: number;
  monthly_points: number;
  failed_count: number;
  success_rate: number;
  streak: number;
  level_id: string;
}

const STARTER_LEVEL: NurseLevel = NURSE_LEVELS[0] ?? {
  id: "lv-1", name: "مبتدئ", minPoints: 0, color: "#94A3B8",
};

function rowToGamification(r: RawGamificationRow): NurseGamification {
  const level = NURSE_LEVELS.find((lv) => lv.id === r.level_id) ?? STARTER_LEVEL;
  return {
    nurseId: r.nurse_id,
    totalCompleted: r.total_completed,
    totalPoints: r.total_points,
    pointsToday: r.points_today,
    monthlyCompleted: r.monthly_completed,
    monthlyPoints: r.monthly_points,
    successRate: r.success_rate,
    failedCount: r.failed_count,
    streak: r.streak,
    level,
    badges: [],
  };
}

export function starterGamification(nurseId: string): NurseGamification {
  return {
    nurseId,
    totalCompleted: 0,
    totalPoints: 0,
    pointsToday: 0,
    level: STARTER_LEVEL,
    badges: [],
    monthlyCompleted: 0,
    monthlyPoints: 0,
    successRate: 100,
    failedCount: 0,
    streak: 0,
  };
}

// Hook: returns the live gamification row for a nurse. Starts with a starter
// shape so the UI can render immediately, then swaps to the DB row once the
// fetch lands. Admin-created nurses get auto-created rows because the API
// uses ensure_nurse_gamification_admin.
export function useNurseGamification(nurseId: string): NurseGamification {
  const [game, setGame] = useState<NurseGamification>(() => starterGamification(nurseId));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!USE_SUPABASE || !isUuid(nurseId)) return;
      try {
        const res = await fetch(`/api/nurses/${encodeURIComponent(nurseId)}/gamification`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = await res.json().catch(() => null);
        const row = body?.gamification as RawGamificationRow | null | undefined;
        if (row && !cancelled) setGame(rowToGamification(row));
      } catch {
        // Keep the starter shape on failure.
      }
    })();
    return () => { cancelled = true; };
  }, [nurseId]);
  return game;
}
