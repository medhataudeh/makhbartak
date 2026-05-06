import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { isUuid } from "@/lib/supabase/uuid";
import { requireAdmin } from "@/lib/route-auth";
import { logger } from "@/lib/logger";

// Phase 5.2 — admin CRUD for lab_payout_rules.
//   GET    list all (joined with lab + test names)
//   POST   create OR upsert (one rule per (lab, test) or per (lab, NULL))
//   DELETE ?id=<uuid>  delete by rule id

interface UpsertBody {
  labId: string;
  labTestId?: string | null;          // null/missing = lab-default
  payoutType: "fixed" | "percentage";
  payoutValue: number;
  isActive?: boolean;
  notes?: string;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("lab_payout_rules")
    .select(`
      id, lab_id, lab_test_id, payout_type, payout_value, is_active, notes,
      created_at, updated_at,
      lab:labs ( id, name_ar ),
      test:lab_tests ( id, name_ar, name_en )
    `)
    .order("lab_id", { ascending: true })
    .order("lab_test_id", { ascending: true, nullsFirst: true });
  if (error) {
    logger.error("admin/lab-payout-rules list failed", { route: "api/admin/lab-payout-rules", code: error.code });
    return NextResponse.json({ error: "تعذر قراءة قواعد المستحقات" }, { status: 500 });
  }
  type Row = {
    id: string; lab_id: string | null; lab_test_id: string | null;
    payout_type: "fixed" | "percentage"; payout_value: number;
    is_active: boolean; notes: string | null;
    created_at: string; updated_at: string;
    lab: { id: string; name_ar: string }[] | null;
    test: { id: string; name_ar: string; name_en: string | null }[] | null;
  };
  const rules = ((data ?? []) as unknown as Row[]).map((r) => {
    const lab = Array.isArray(r.lab) ? r.lab[0] : null;
    const test = Array.isArray(r.test) ? r.test[0] : null;
    return {
      id: r.id,
      labId: r.lab_id,
      labName: lab?.name_ar ?? "—",
      labTestId: r.lab_test_id,
      labTestNameAr: test?.name_ar ?? null,
      labTestNameEn: test?.name_en ?? null,
      payoutType: r.payout_type,
      payoutValue: Number(r.payout_value),
      isActive: r.is_active,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: UpsertBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!isUuid(body.labId)) {
    return NextResponse.json({ error: "labId is required" }, { status: 400 });
  }
  if (body.labTestId !== undefined && body.labTestId !== null && !isUuid(body.labTestId)) {
    return NextResponse.json({ error: "labTestId must be a uuid" }, { status: 400 });
  }
  if (body.payoutType !== "fixed" && body.payoutType !== "percentage") {
    return NextResponse.json({ error: "payoutType must be 'fixed' or 'percentage'" }, { status: 400 });
  }
  const v = Number(body.payoutValue);
  if (!Number.isFinite(v) || v < 0) {
    return NextResponse.json({ error: "payoutValue must be a non-negative number" }, { status: 400 });
  }
  if (body.payoutType === "percentage" && v > 100) {
    return NextResponse.json({ error: "النسبة لا يمكن أن تتجاوز 100" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  // Upsert: one rule per (lab, test) and one per (lab, null).
  let existsQ = sb.from("lab_payout_rules").select("id").eq("lab_id", body.labId);
  if (body.labTestId == null) existsQ = existsQ.is("lab_test_id", null);
  else                        existsQ = existsQ.eq("lab_test_id", body.labTestId);
  const { data: existing } = await existsQ.limit(1).maybeSingle();

  if (existing?.id) {
    const { error } = await sb.from("lab_payout_rules")
      .update({
        payout_type:  body.payoutType,
        payout_value: v,
        is_active:    body.isActive !== false,
        notes:        body.notes ?? null,
      })
      .eq("id", existing.id);
    if (error) {
      logger.error("lab-payout-rules update failed", { route: "api/admin/lab-payout-rules", code: error.code });
      return NextResponse.json({ error: "تعذر تحديث القاعدة" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: existing.id });
  }

  const { data: inserted, error } = await sb.from("lab_payout_rules")
    .insert({
      lab_id: body.labId,
      lab_test_id: body.labTestId ?? null,
      payout_type: body.payoutType,
      payout_value: v,
      is_active: body.isActive !== false,
      notes: body.notes ?? null,
      created_by: auth.session.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("lab-payout-rules insert failed", { route: "api/admin/lab-payout-rules", code: error.code });
    return NextResponse.json({ error: "تعذر إنشاء القاعدة" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: inserted.id });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !isUuid(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("lab_payout_rules").delete().eq("id", id);
  if (error) {
    logger.error("lab-payout-rules delete failed", { route: "api/admin/lab-payout-rules", code: error.code });
    return NextResponse.json({ error: "تعذر حذف القاعدة" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
