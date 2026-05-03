import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireNurseSelfOrAdmin } from "@/lib/route-auth";

interface UpdateNurseProfileBody {
  name?: string;
  city?: string;
  photoUrl?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nurseId } = await ctx.params;
  if (!isUuid(nurseId)) {
    return NextResponse.json({ error: "nurse id must be a uuid" }, { status: 400 });
  }
  const auth = await requireNurseSelfOrAdmin(nurseId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: UpdateNurseProfileBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { name, city, photoUrl } = body ?? {};
  if (name == null && city == null && photoUrl == null) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: rpcErr } = await sb.rpc("update_nurse_profile_admin", {
    p_nurse_id: nurseId,
    p_name: name ?? null,
    p_city: city ?? null,
    p_photo_url: photoUrl ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const { data: nurse } = await sb
    .from("nurses")
    .select("id, city, is_active, profile_id, profiles ( full_name, phone, photo_url )")
    .eq("id", nurseId)
    .maybeSingle();
  return NextResponse.json({ nurse });
}
