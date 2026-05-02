import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { fetchOrderById } from "@/lib/supabase/queries/orders";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();
  const order = await fetchOrderById(sb, id);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ order });
}
