import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface PatchLabBody {
  session: AuthSession;
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
  let body: PatchLabBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, patch } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  if (session.role !== "admin" && session.role !== "lab") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  // Lab-side self-edit is restricted to a whitelist (enforced server-side).
  // Admin override unlocks the full patch shape.
  const fullPatch = session.role === "admin";

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("upsert_lab_admin", {
    p_lab_id: labId,
    p_patch: patch ?? {},
    p_full_patch: fullPatch,
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const { data: lab } = await sb
    .from("labs").select("*").eq("id", labId).maybeSingle();
  return NextResponse.json({ lab });
}
