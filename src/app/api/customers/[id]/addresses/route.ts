import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireCustomerSelfOrAdmin } from "@/lib/route-auth";

interface UpsertBody {
  label: string;
  description: string;
  city: string;
  area?: string;
  lat?: number | null;
  lng?: number | null;
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
  const { label, description, city, area, lat, lng, isDefault } = body ?? {};
  if (!label?.trim() || !description?.trim() || !city?.trim()) {
    return NextResponse.json({ error: "label, description, city are required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: id, error: rpcErr } = await sb.rpc("upsert_address_admin", {
    p_customer_id: customerId,
    p_id: null,
    p_label: label,
    p_description: description,
    p_city: city,
    p_area: area ?? null,
    p_lat: typeof lat === "number" ? lat : null,
    p_lng: typeof lng === "number" ? lng : null,
    p_is_default: !!isDefault,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const { data: address } = await sb
    .from("addresses")
    .select("id, customer_id, label, description, city, area, lat, lng, is_default")
    .eq("id", id).maybeSingle();
  return NextResponse.json({ address });
}
