import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; nid: string }> },
) {
  const { id: customerId, nid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(nid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
