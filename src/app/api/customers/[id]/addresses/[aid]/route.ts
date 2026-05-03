import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface PatchBody {
  session: AuthSession;
  label?: string;
  description?: string;
  city?: string;
  area?: string;
  lat?: number | null;
  lng?: number | null;
  isDefault?: boolean;
}
interface DeleteBody { session: AuthSession }

function authorize(session: AuthSession, customerId: string): string | null {
  if (!session) return "session required";
  if (session.role === "customer") {
    if (session.linkedEntityId !== customerId) return "you can only edit your own addresses";
  } else if (session.role !== "admin") {
    return "role not authorized";
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; aid: string }> },
) {
  const { id: customerId, aid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(aid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  let body: PatchBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, label, description, city, area, lat, lng, isDefault } = body ?? {};
  const denied = authorize(session, customerId);
  if (denied) return NextResponse.json({ error: denied }, { status: session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { data: id, error: rpcErr } = await sb.rpc("upsert_address_admin", {
    p_customer_id: customerId,
    p_id: aid,
    p_label: label ?? null,
    p_description: description ?? null,
    p_city: city ?? null,
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

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; aid: string }> },
) {
  const { id: customerId, aid } = await ctx.params;
  if (!isUuid(customerId) || !isUuid(aid)) {
    return NextResponse.json({ error: "ids must be uuids" }, { status: 400 });
  }
  let body: DeleteBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const denied = authorize(body?.session, customerId);
  if (denied) return NextResponse.json({ error: denied }, { status: body?.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("delete_address_admin", {
    p_customer_id: customerId,
    p_id: aid,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
