import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import type { AuthSession } from "@/lib/types";

interface VerifyPatientBody {
  session: AuthSession;
  officialName: string;
  nationalId?: string;
  note?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  }
  let body: VerifyPatientBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { session, officialName, nationalId, note } = body ?? {};
  if (!session) return NextResponse.json({ error: "session required" }, { status: 401 });
  // Nurses verify in the field; admins can fix from the OCC.
  if (session.role !== "admin" && session.role !== "nurse") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  if (!officialName || !officialName.trim()) {
    return NextResponse.json({ error: "officialName is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("verify_patient_admin", {
    p_order_id: orderId,
    p_official_name: officialName,
    p_national_id: nationalId ?? null,
    p_note: note ?? null,
    p_actor_role: session.role,
    p_actor_id: null,
    p_actor_name: session.name ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
