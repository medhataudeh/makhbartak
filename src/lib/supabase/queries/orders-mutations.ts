import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "@/lib/types";
import { isUuid } from "@/lib/supabase/auth-helpers";

export interface PlaceOrderResult {
  ok: boolean;
  orderId?: string;
  error?: string;
}

/**
 * @deprecated Phase 1 wires order creation through `/api/orders`
 * (server-side service role + `place_order_admin` RPC). Kept here so that
 * Phase 2 — when real Supabase Auth is in place — can switch back to the
 * direct browser-side `place_order` RPC by re-importing this from store.ts.
 */
export async function placeOrderRemote(
  sb: SupabaseClient,
  order: Order,
  idempotencyKey: string
): Promise<PlaceOrderResult> {
  // place_order resolves customer_id from auth.uid() on the server, so we
  // only need to gate the foreign-key uuids that come from the client.
  if (!isUuid(order.patient.id) || !isUuid(order.address.id)) {
    return { ok: false, error: "invalid uuid in order payload (skipped)" };
  }
  const payload = {
    public_number: order.publicNumber,
    patient_id: order.patient.id,
    address_id: order.address.id,
    kind: order.type,
    package_id: order.packageSnapshot?.packageId ?? null,
    package_snapshot: order.packageSnapshot ?? null,
    status: order.status,
    visit_date: order.visitDate,
    shift: order.shift,
    shift_start_time: order.shiftStartTime ?? null,
    shift_end_time: order.shiftEndTime ?? null,
    subtotal: order.subtotal,
    coupon_code: order.couponCode ?? null,
    coupon_discount: order.couponDiscount,
    total: order.total,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    items: order.items.map((it, i) => ({
      lab_test_id: it.testId,
      name_ar_snapshot: it.nameAr,
      name_en_snapshot: it.nameEn,
      price_snapshot: it.priceSnapshot,
      display_order: i,
    })),
  };

  const { data, error } = await sb.rpc("place_order", {
    payload,
    idempotency_key: idempotencyKey,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, orderId: data as string };
}

// ─── Lifecycle mutators (Stage 12.6) ───────────────────────────────────────

export interface MutationResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export async function setOrderStatusRemote(
  sb: SupabaseClient,
  orderId: string,
  status: string,
  note?: string
): Promise<MutationResult> {
  if (!isUuid(orderId)) return { ok: false, error: "invalid uuid (skipped)" };
  const { error } = await sb.rpc("set_order_status", {
    p_order_id: orderId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function assignNurseRemote(
  sb: SupabaseClient,
  orderId: string,
  nurseId: string
): Promise<MutationResult> {
  if (!isUuid(orderId) || !isUuid(nurseId)) return { ok: false, error: "invalid uuid (skipped)" };
  const { error } = await sb.rpc("assign_nurse", {
    p_order_id: orderId,
    p_nurse_id: nurseId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function uploadResultFileRemote(
  sb: SupabaseClient,
  orderId: string,
  storagePath: string,
  fileName: string,
  opts: { mimeType?: string; sizeBytes?: number; replacesId?: string } = {}
): Promise<MutationResult> {
  if (!isUuid(orderId)) return { ok: false, error: "invalid uuid (skipped)" };
  if (opts.replacesId && !isUuid(opts.replacesId)) {
    return { ok: false, error: "invalid uuid in replacesId (skipped)" };
  }
  const { data, error } = await sb.rpc("upload_result_file", {
    p_order_id: orderId,
    p_storage_path: storagePath,
    p_file_name: fileName,
    p_mime_type: opts.mimeType ?? null,
    p_size_bytes: opts.sizeBytes ?? null,
    p_replaces_id: opts.replacesId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data as string };
}

export async function archiveResultFileRemote(
  sb: SupabaseClient,
  fileId: string,
  note?: string
): Promise<MutationResult> {
  if (!isUuid(fileId)) return { ok: false, error: "invalid uuid (skipped)" };
  const { error } = await sb.rpc("archive_result_file", {
    p_file_id: fileId,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
