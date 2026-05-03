import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession, LabIssueType } from "@/lib/types";

const ALLOWED: LabIssueType[] = ["invalid_sample", "incomplete_sample", "patient_data_error", "needs_redrawn", "other"];

interface OpenIssueBody {
  session: AuthSession;
  type: LabIssueType;
  description: string;
  customerMessageAr?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  let body: OpenIssueBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, type, description, customerMessageAr } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role !== "lab" && session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  if (!ALLOWED.includes(type)) {
    return NextResponse.json({ error: "invalid issue type" }, { status: 400 });
  }
  if (!description || !description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: issueId, error: rpcErr } = await sb.rpc("open_lab_issue_admin", {
    p_order_id: orderId,
    p_type: type,
    p_description: description,
    p_customer_message_ar: customerMessageAr ?? null,
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched, issueId });
}
