import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";

// Nurse-side counterpart of /api/customers/[id]/notifications/[nid]/read.
// Stage 1 of production hardening: nurse inbox is now real DB rows, so the
// read flag has to round-trip too. The recipient_id stored on the
// notifications row is the nurse's profile_id (auth.users.id), which we
// resolve from the nurse row before invoking the existing RPC.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; nid: string }> },
) {
  const { id: nurseId, nid } = await ctx.params;
  if (!isUuid(nurseId) || !isUuid(nid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  const auth = await requireNurseSelfOrAdmin(nurseId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data: nurse, error: nErr } = await sb
    .from("nurses").select("profile_id").eq("id", nurseId).maybeSingle();
  if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 });
  if (!nurse?.profile_id) {
    return NextResponse.json({ error: "nurse profile missing" }, { status: 404 });
  }

  const { error: rpcErr } = await sb.rpc("mark_notification_read_admin", {
    p_id: nid, p_recipient_id: nurse.profile_id,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
