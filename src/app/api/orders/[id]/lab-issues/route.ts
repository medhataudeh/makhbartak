import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import type { LabIssueType } from "@/lib/types";

const ALLOWED: LabIssueType[] = ["invalid_sample", "incomplete_sample", "patient_data_error", "needs_redrawn", "other"];

interface OpenIssueBody {
  type: LabIssueType;
  description: string;
  customerMessageAr?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "lab" && auth.session.role !== "admin") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  let body: OpenIssueBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!ALLOWED.includes(body.type)) {
    return NextResponse.json({ error: "invalid issue type" }, { status: 400 });
  }
  if (!body.description || !body.description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Ownership pre-flight: a lab session may only open issues against orders
  // assigned to its lab. Admin is unrestricted.
  if (auth.session.role === "lab") {
    if (!auth.session.labId) {
      return NextResponse.json(
        { error: "حساب المختبر غير مكتمل. تواصل مع الإدارة." },
        { status: 403 },
      );
    }
    const { data: row, error: rowErr } = await sb
      .from("orders").select("id, lab_id").eq("id", orderId).maybeSingle();
    if (rowErr) {
      return NextResponse.json({ error: "تعذر قراءة الطلب من قاعدة البيانات" }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }
    if (row.lab_id !== auth.session.labId) {
      return NextResponse.json(
        { error: "لا تملك صلاحية فتح مشكلة على هذا الطلب" },
        { status: 403 },
      );
    }
  }

  const { data: issueId, error: rpcErr } = await sb.rpc("open_lab_issue_admin", {
    p_order_id: orderId,
    p_type: body.type,
    p_description: body.description,
    p_customer_message_ar: body.customerMessageAr ?? null,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched, issueId });
}
