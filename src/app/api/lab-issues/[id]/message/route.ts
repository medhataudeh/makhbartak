import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";

interface UpdateMessageBody {
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
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: UpdateMessageBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("update_lab_issue_message_admin", {
    p_issue_id: issueId,
    p_customer_message_ar: body.customerMessageAr ?? "",
    p_actor_role: "admin",
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
