import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { requireAuthedUser } from "@/lib/route-auth";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();
  const order = await fetchOrderById(sb, id);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Ownership: admin sees all; customer/nurse/lab only their own resource.
  // Lab result PDFs are signed by enrichOrdersWithSignedUrls below, so this
  // gate is the only thing keeping medical PII behind a UUID.
  const s = auth.session;
  const allowed =
    s.role === "admin" ||
    (s.role === "customer" && !!s.customerId && order.userId === s.customerId) ||
    (s.role === "nurse"    && !!s.nurseId    && order.nurseId  === s.nurseId) ||
    (s.role === "lab"      && !!s.labId      && order.labId    === s.labId);
  if (!allowed) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  const [enriched] = await enrichOrdersWithSignedUrls(sb, [order]);
  return NextResponse.json({ order: enriched });
}
