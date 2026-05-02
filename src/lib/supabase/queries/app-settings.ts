import type { SupabaseClient } from "@supabase/supabase-js";
import type { SystemSettings } from "@/lib/types";

// Reads the singleton row from public.app_settings (id=1) and maps the
// snake_case columns to the camelCase shape the UI already expects.
//
// Returns null when the row is missing or the call fails — caller falls
// back to the legacy local value so the UI never goes blank.
export async function fetchAppSettings(
  sb: SupabaseClient
): Promise<Partial<SystemSettings> | null> {
  const { data, error } = await sb
    .from("app_settings")
    .select(
      "min_booking_notice_minutes, morning_shift_start, morning_shift_end, evening_shift_start, evening_shift_end, supported_cities, whatsapp_number, allow_cash_orders, booking_horizon_days, max_orders_per_shift"
    )
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;

  return {
    minBookingNoticeMinutes: data.min_booking_notice_minutes,
    morningShiftStart: data.morning_shift_start,
    morningShiftEnd: data.morning_shift_end,
    eveningShiftStart: data.evening_shift_start,
    eveningShiftEnd: data.evening_shift_end,
    supportedCities: data.supported_cities,
    whatsappNumber: data.whatsapp_number,
    allowCashOrders: data.allow_cash_orders,
    // Frontend now uses bookingWindowDays semantics (default 2 = today + 2).
    // The legacy schema column is still booking_horizon_days; remap here so
    // the camelCase shape stays consistent. Schema rename is deferred (D1).
    bookingWindowDays: data.booking_horizon_days,
    maxOrdersPerShift: data.max_orders_per_shift,
  };
}
