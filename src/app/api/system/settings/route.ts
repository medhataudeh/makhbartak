import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";
import type { SystemSettings } from "@/lib/types";

// Public-read system settings. Every portal (customer/nurse/lab/admin,
// including guests on `/`) calls this on mount to hydrate cash-gate,
// shift hours, booking window, etc. The row is the singleton at id=1.
export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("app_settings")
    .select(
      "min_booking_notice_minutes, morning_shift_start, morning_shift_end, evening_shift_start, evening_shift_end, supported_cities, whatsapp_number, allow_cash_orders, booking_horizon_days, max_orders_per_shift, enable_stripe, stripe_public_key, stripe_mode"
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ settings: null });
  const settings: Partial<SystemSettings> = {
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
  };
  return NextResponse.json({ settings });
}
