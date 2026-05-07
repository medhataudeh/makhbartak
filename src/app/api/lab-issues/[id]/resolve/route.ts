import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";
import { logger } from "@/lib/logger";

interface ResolveBody {
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: issueId } = await ctx.params;
  if (!isUuid(issueId)) {
    return NextResponse.json({ error: "issue id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "admin" && auth.session.role !== "lab") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  let body: ResolveBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // P5.1 — pre-flight cross-lab ownership. A lab session may only resolve
  // issues against orders assigned to its lab. Admin is unrestricted. This
  // mirrors the pattern already used by the open-issue route
  // (src/app/api/orders/[id]/lab-issues/route.ts) and the lab-confirm route
  // (src/app/api/orders/[id]/lab/confirm/route.ts). The RPC re-checks the
  // same invariant at the data layer (mig 041) so any future caller that
  // skips this pre-flight is still refused.
  if (auth.session.role === "lab") {
    if (!auth.session.labId) {
      return NextResponse.json(
        { error: "حساب المختبر غير مكتمل. تواصل مع الإدارة." },
        { status: 403 },
      );
    }
    const { data: row, error: rowErr } = await sb
      .from("lab_issues").select("id, lab_id").eq("id", issueId).maybeSingle();
    if (rowErr) {
      return NextResponse.json(
        { error: "تعذر قراءة المشكلة من قاعدة البيانات" },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json({ error: "المشكلة غير موجودة" }, { status: 404 });
    }
    if (row.lab_id !== auth.session.labId) {
      logger.warn("lab-issue resolve refused — cross-lab attempt", {
        route: "api/lab-issues/resolve",
        issueId, expected: row.lab_id, sessionLabId: auth.session.labId,
      });
      return NextResponse.json(
        { error: "لا تملك صلاحية حل هذه المشكلة" },
        { status: 403 },
      );
    }
  }

  const { error: rpcErr } = await sb.rpc("resolve_lab_issue_admin", {
    p_issue_id: issueId,
    p_note: body?.note ?? null,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
    // P5.1 — RPC defense-in-depth (mig 041). Lab sessions pass their
    // session.labId so the RPC re-checks ownership; admin callers pass
    // null and the RPC skips the check.
    p_actor_lab_id: auth.session.role === "lab" ? auth.session.labId ?? null : null,
  });
  // TODO(P5.4): replace raw rpcErr.message echo with safeApiError().
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
