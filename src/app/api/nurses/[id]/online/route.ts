import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";

interface SetOnlineBody {
  isOnline: boolean;
}

// POST /api/nurses/[id]/online
// Toggles `nurses.is_online`. Used by the nurse app to mark "I'm starting
// a shift" / "I'm offline now". The morning prep checklist surfaces only
// during the off→on transition (handled client-side from this state).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireNurseSelfOrAdmin(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: SetOnlineBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const isOnline = !!body.isOnline;

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("nurses")
    .update({
      is_online: isOnline,
      online_since: isOnline ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) {
    console.error("[api/nurses/online] update failed", { id, code: error.code, message: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, isOnline });
}

// GET /api/nurses/[id]/online → current flag.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  const auth = await requireNurseSelfOrAdmin(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("nurses").select("is_online, online_since").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ isOnline: !!data?.is_online, onlineSince: data?.online_since ?? null });
}
