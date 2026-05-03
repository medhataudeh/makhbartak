import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

interface SetPrefBody {
  method: "cash" | "online";
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await ctx.params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customer id must be a uuid" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: SetPrefBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { method } = body ?? {};
  if (method !== "cash" && method !== "online") {
    return NextResponse.json({ error: "method must be cash or online" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("set_payment_pref_admin", {
    p_customer_id: customerId,
    p_method: method,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
