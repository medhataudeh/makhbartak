import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

interface UpsertBody {
  name: string;
  nationalId?: string;
  note?: string;
  isDefault?: boolean;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await ctx.params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customer id must be a uuid" }, { status: 400 });
  }
  const auth = await requireCustomerSelfOrAdmin(customerId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: UpsertBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { name, nationalId, note, isDefault } = body ?? {};
  if (!name || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: id, error: rpcErr } = await sb.rpc("upsert_patient_admin", {
    p_customer_id: customerId,
    p_id: null,
    p_name: name,
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
