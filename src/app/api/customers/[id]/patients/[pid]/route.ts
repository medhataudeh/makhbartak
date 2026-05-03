import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface PatchBody {
  session: AuthSession;
  name?: string;
  nationalId?: string;
  note?: string;
  isDefault?: boolean;
}
interface DeleteBody { session: AuthSession }

function authorize(session: AuthSession, customerId: string): string | null {
  if (!session) return "session required";
  if (session.role === "customer") {
    if (session.linkedEntityId !== customerId) return "you can only edit your own patients";
  } else if (session.role !== "admin") {
    return "role not authorized";
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const { id: customerId, pid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(pid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  let body: PatchBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, name, nationalId, note, isDefault } = body ?? {};
  const denied = authorize(session, customerId);
  if (denied) return NextResponse.json({ error: denied }, { status: session ? 403 : 401 });
  if (name != null && !name.trim()) {
    return NextResponse.json({ error: "name cannot be blank" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: id, error: rpcErr } = await sb.rpc("upsert_patient_admin", {
    p_customer_id: customerId,
    p_id: pid,
    p_name: name ?? null,
    p_national_id: nationalId ?? null,
    p_note: note ?? null,
    p_is_default: !!isDefault,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  const { data: patient } = await sb
    .from("patients")
    .select("id, customer_id, name, national_id, note, is_default")
    .eq("id", id).maybeSingle();
  return NextResponse.json({ patient });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const { id: customerId, pid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(pid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  let body: DeleteBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const denied = authorize(body?.session, customerId);
  if (denied) return NextResponse.json({ error: denied }, { status: body?.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("delete_patient_admin", {
    p_customer_id: customerId,
    p_id: pid,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
