import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";
import { logger } from "@/lib/logger";
import type { AdminSystemSettings, SystemSettings } from "@/lib/types";

// Admin-only PATCH for app_settings. Mirrors the legacy POST at
// /api/admin/app-settings (still wired for backward compat) but accepts
// camelCase keys directly and translates them to the snake_case columns
// the RPC expects.
interface PatchBody {
  patch: Partial<SystemSettings>;
}

const KEY_MAP: Partial<Record<keyof SystemSettings, string>> = {
  minBookingNoticeMinutes: "min_booking_notice_minutes",
  morningShiftStart: "morning_shift_start",
  morningShiftEnd: "morning_shift_end",
  eveningShiftStart: "evening_shift_start",
  eveningShiftEnd: "evening_shift_end",
  supportedCities: "supported_cities",
  whatsappNumber: "whatsapp_number",
  allowCashOrders: "allow_cash_orders",
  bookingWindowDays: "booking_horizon_days",
  maxOrdersPerShift: "max_orders_per_shift",
  enableStripe: "enable_stripe",
  stripePublicKey: "stripe_public_key",
  stripeMode: "stripe_mode",
  nurseCommissionPercentage: "nurse_commission_percentage",
};

// Admin-only GET. Returns the full AdminSystemSettings shape including
// finance-sensitive fields (nurseCommissionPercentage) that the public
// /api/system/settings route deliberately never exposes. Phase B of the
// public/private split lays this surface down without touching the public
// route or any UI consumer yet.
//
// Cap: system.app_settings.read (super, finance, ops, content read-only).
// Cache-Control: private, no-store — the response varies by auth state and
// must not be served from any intermediary cache.
export async function GET() {
  const auth = await requireAdminCap("system.app_settings.read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("app_settings")
    .select(
      "min_booking_notice_minutes, morning_shift_start, morning_shift_end, evening_shift_start, evening_shift_end, supported_cities, whatsapp_number, allow_cash_orders, booking_horizon_days, max_orders_per_shift, enable_stripe, stripe_public_key, stripe_mode, nurse_commission_percentage",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    logger.error("admin/system/settings GET failed", {
      route: "api/admin/system/settings",
      code: error.code,
    });
    return NextResponse.json({ error: "تعذر قراءة إعدادات النظام" }, { status: 500 });
  }

  const headers = { "Cache-Control": "private, no-store" } as const;
  if (!data) return NextResponse.json({ settings: null }, { headers });

  const settings: AdminSystemSettings = {
    minBookingNoticeMinutes: data.min_booking_notice_minutes,
    morningShiftStart: data.morning_shift_start,
    morningShiftEnd: data.morning_shift_end,
    eveningShiftStart: data.evening_shift_start,
    eveningShiftEnd: data.evening_shift_end,
    supportedCities: data.supported_cities,
    whatsappNumber: data.whatsapp_number,
    allowCashOrders: data.allow_cash_orders,
    bookingWindowDays: data.booking_horizon_days,
    maxOrdersPerShift: data.max_orders_per_shift,
    enableStripe: data.enable_stripe ?? false,
    stripePublicKey: data.stripe_public_key ?? "",
    stripeMode: (data.stripe_mode as "test" | "live") ?? "test",
    nurseCommissionPercentage: Number(data.nurse_commission_percentage ?? 0),
  };
  return NextResponse.json({ settings }, { headers });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminCap("system.app_settings.write");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body || !body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const wire: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body.patch)) {
    const col = KEY_MAP[k as keyof SystemSettings];
    if (col) wire[col] = v;
  }
  if (Object.keys(wire).length === 0) {
    return NextResponse.json({ error: "no recognised keys in patch" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb.rpc("update_app_settings_admin", { p_patch: wire });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminActivity(
    sb,
    auth.session,
    "settings_change",
    "app_settings",
    "1",
    `keys:${Object.keys(wire).join(",")}`,
  );

  return NextResponse.json({ ok: true });
}
