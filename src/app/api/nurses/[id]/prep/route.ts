import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface SetPrepBody {
  session: AuthSession;
  day: string;
  started?: boolean;
  checkedIds?: string[];
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) {
    return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  }
  const url = new URL(req.url);
  const day = url.searchParams.get("day");
  if (!day || !DATE_RE.test(day)) {
    return NextResponse.json({ error: "day query param required (YYYY-MM-DD)" }, { status: 400 });
  }
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurse_prep_state")
    .select("nurse_id, day, started, checked_ids, updated_at")
    .eq("nurse_id", nurseId)
    .eq("day", day)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    prep: data ?? { nurse_id: nurseId, day, started: false, checked_ids: [] },
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) {
    return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  }
  let body: SetPrepBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, day, started, checkedIds } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role === "nurse") {
    if (session.linkedEntityId !== nurseId) {
      return NextResponse.json({ error: "you can only edit your own prep state" }, { status: 403 });
    }
  } else if (session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  if (!day || !DATE_RE.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("set_nurse_prep_admin", {
    p_nurse_id: nurseId,
    p_day: day,
    p_started: !!started,
    p_checked_ids: Array.isArray(checkedIds) ? checkedIds : [],
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
