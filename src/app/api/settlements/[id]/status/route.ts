import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

const ALLOWED = ["pending", "partially_paid", "paid"] as const;
type Status = (typeof ALLOWED)[number];

interface SetStatusBody {
  session: AuthSession;
  status: Status;
  totalPaid?: number;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: settlementId } = await ctx.params;
  if (!isUuid(settlementId)) {
    return NextResponse.json({ error: "settlement id must be a uuid" }, { status: 400 });
  }
  let body: SetStatusBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, status, totalPaid } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "only admin can change settlement status" }, { status: 403 });
  }
  if (!ALLOWED.includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("set_settlement_status_admin", {
    p_settlement_id: settlementId,
    p_status: status,
    p_total_paid: typeof totalPaid === "number" ? totalPaid : null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
