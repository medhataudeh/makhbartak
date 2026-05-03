import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) {
    return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  }
  const sb = getSupabaseAdmin();
  const { data: nurse, error: nErr } = await sb
    .from("nurses").select("profile_id").eq("id", nurseId).maybeSingle();
  if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 });
  if (!nurse?.profile_id) {
    return NextResponse.json({ notifications: [] });
  }
  const { data, error } = await sb
    .from("notifications")
    .select(`id, recipient_id, type, title_ar, body_ar, order_id, is_read, created_at`)
    .eq("recipient_id", nurse.profile_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}
