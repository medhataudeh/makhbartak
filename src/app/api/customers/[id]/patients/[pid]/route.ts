import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

interface PatchBody {
  name?: string;
  nationalId?: string;
  note?: string;
  isDefault?: boolean;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const { id: customerId, pid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(pid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: PatchBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { name, nationalId, note, isDefault } = body ?? {};
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
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const { id: customerId, pid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(pid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("delete_patient_admin", {
    p_customer_id: customerId,
    p_id: pid,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
