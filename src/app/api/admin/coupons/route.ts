import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminSession } from "@/lib/admin-auth";

interface UpsertBody {
  session: import("@/lib/types").AuthSession;
  id?: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minOrderAmount?: number;
  maxDiscount?: number;
  usageLimit?: number;
  startDate: string;
  expiryDate: string;
  isActive?: boolean;
}

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("coupons")
    .select(`id, code, type, value, min_order_amount, max_discount, usage_limit, used_count, start_date, expiry_date, is_active`)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ coupons: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UpsertBody | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const denied = requireAdminSession(body.session);
  if (denied) return NextResponse.json({ error: denied }, { status: body.session ? 403 : 401 });

  const sb = getSupabaseAdmin();
  const { data: id, error } = await sb.rpc("upsert_coupon_admin", {
    p_id: body.id ?? null,
    p_code: body.code,
    p_type: body.type,
    p_value: body.value,
    p_min_order_amount: body.minOrderAmount ?? 0,
    p_max_discount: body.maxDiscount ?? 0,
    p_usage_limit: body.usageLimit ?? 0,
    p_start_date: body.startDate,
    p_expiry_date: body.expiryDate,
    p_is_active: body.isActive ?? true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id });
}
