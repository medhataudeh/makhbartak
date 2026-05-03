import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";

interface SubmitBody {
  day?: string;
  note?: string;
  items: Array<{ toolId?: string | null; nameSnapshot: string; quantity?: number }>;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) {
    return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  }
  const auth = await requireNurseSelfOrAdmin(nurseId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurse_shortage_requests")
    .select(`
      id, nurse_id, nurse_name, day, note, status, created_at,
      resolved_at, resolved_by_admin_name,
      items:nurse_shortage_request_items ( id, tool_id, name_snapshot, quantity )
    `)
    .eq("nurse_id", nurseId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) {
    return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  }
  const auth = await requireNurseSelfOrAdmin(nurseId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: SubmitBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { day, note, items } = body ?? {};
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items[] is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: requestId, error: rpcErr } = await sb.rpc("submit_shortage_request_admin", {
    p_nurse_id: nurseId,
    p_nurse_name: auth.session.fullName ?? null,
    p_day: day ?? null,
    p_note: note ?? null,
    p_items: items.map((it) => ({
      tool_id: it.toolId ?? null,
      name_snapshot: it.nameSnapshot,
      quantity: it.quantity ?? 1,
    })),
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, requestId });
}
