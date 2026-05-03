import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

interface PatchLabBody {
  patch: Record<string, unknown>;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: labId } = await ctx.params;
  if (!isUuid(labId)) {
    return NextResponse.json({ error: "lab id must be a uuid" }, { status: 400 });
  }
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "admin" && auth.session.role !== "lab") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  // Lab user can only edit their own lab; lab_admin sub-role required.
  if (auth.session.role === "lab") {
    if (!auth.session.labId || auth.session.labId !== labId) {
      return NextResponse.json({ error: "cannot edit another lab" }, { status: 403 });
    }
    if (auth.session.labRole !== "lab_admin") {
      return NextResponse.json({ error: "lab_admin role required" }, { status: 403 });
    }
  }
  let body: PatchLabBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const fullPatch = auth.session.role === "admin";

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("upsert_lab_admin", {
    p_lab_id: labId,
    p_patch: body.patch ?? {},
    p_full_patch: fullPatch,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const { data: lab } = await sb
    .from("labs").select("*").eq("id", labId).maybeSingle();
  return NextResponse.json({ lab });
}
