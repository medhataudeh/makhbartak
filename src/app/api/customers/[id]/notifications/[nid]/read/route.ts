import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface MarkReadBody { session: AuthSession }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; nid: string }> },
) {
  const { id: customerId, nid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(nid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as MarkReadBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const { session } = body;
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role === "customer") {
    if (session.linkedEntityId !== customerId) {
      return NextResponse.json({ error: "you can only mark your own notifications" }, { status: 403 });
    }
  } else if (session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();
  const { data: customer, error: cErr } = await sb
    .from("customers").select("profile_id").eq("id", customerId).maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!customer?.profile_id) {
    return NextResponse.json({ error: "customer profile missing" }, { status: 404 });
  }

  const { error: rpcErr } = await sb.rpc("mark_notification_read_admin", {
    p_id: nid, p_recipient_id: customer.profile_id,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
