import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import { requireAdminCap } from "@/lib/route-auth";
import { logAdminActivity } from "@/lib/admin-activity";
import type { SystemSettings } from "@/lib/types";

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
