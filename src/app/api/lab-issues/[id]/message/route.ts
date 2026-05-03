import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface UpdateMessageBody {
  session: AuthSession;
  customerMessageAr: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: issueId } = await ctx.params;
  if (!isUuid(issueId)) {
    return NextResponse.json({ error: "issue id must be a uuid" }, { status: 400 });
  }
  let body: UpdateMessageBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, customerMessageAr } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "only admin can edit the customer-facing message" }, { status: 403 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("update_lab_issue_message_admin", {
    p_issue_id: issueId,
    p_customer_message_ar: customerMessageAr ?? "",
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
