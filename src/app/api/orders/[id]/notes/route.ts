import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { enrichOrdersWithSignedUrls, fetchOrderById } from "@/lib/supabase/queries/orders";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAuthedUser } from "@/lib/route-auth";

interface AddNoteBody {
  text: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  if (!isUuid(orderId)) return NextResponse.json({ error: "order id must be a uuid" }, { status: 400 });
  const auth = await requireAuthedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.session.role !== "admin" && auth.session.role !== "lab" && auth.session.role !== "nurse") {
    return NextResponse.json({ error: "role not authorized" }, { status: 403 });
  }
  let body: AddNoteBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.text || !body.text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Ownership pre-flight for non-admin actors. A nurse may only annotate
  // their own assigned orders; a lab may only annotate orders assigned to
  // its own lab. Admin is unrestricted.
  if (auth.session.role === "nurse" || auth.session.role === "lab") {
    const { data: row, error: rowErr } = await sb
      .from("orders").select("id, nurse_id, lab_id").eq("id", orderId).maybeSingle();
    if (rowErr) {
      return NextResponse.json({ error: "تعذر قراءة الطلب من قاعدة البيانات" }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }
    if (auth.session.role === "nurse") {
      if (!auth.session.nurseId || row.nurse_id !== auth.session.nurseId) {
        return NextResponse.json(
          { error: "هذا الطلب غير مخصص لك" },
          { status: 403 },
        );
      }
    } else {
      if (!auth.session.labId || row.lab_id !== auth.session.labId) {
        return NextResponse.json(
          { error: "لا تملك صلاحية إضافة ملاحظة على هذا الطلب" },
          { status: 403 },
        );
      }
    }
  }

  const { error: rpcErr } = await sb.rpc("add_order_note_admin", {
    p_order_id: orderId,
    p_text: body.text,
    p_actor_role: auth.session.role,
    p_actor_id: auth.session.userId,
    p_actor_name: auth.session.fullName ?? null,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const hydrated = await fetchOrderById(sb, orderId);
  const [enriched] = hydrated ? await enrichOrdersWithSignedUrls(sb, [hydrated]) : [null];
  return NextResponse.json({ order: enriched });
}
