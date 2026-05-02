import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadToBucket, BUCKETS } from "@/lib/supabase/storage";

export interface PrescriptionUploadResult {
  ok: boolean;
  prescriptionId?: string;
  storagePath?: string;
  error?: string;
}

/**
 * Upload a prescription image to the private `prescriptions` bucket and
 * insert a row in public.prescriptions linked to the current customer.
 *
 * Path convention (matches RLS):  <customer_id>/<uuid>.<ext>
 *
 * Returns ok=false when not configured / not authed / upload fails — the
 * caller should fall back to the local mock flow.
 */
export async function uploadPrescription(
  sb: SupabaseClient,
  customerId: string,
  file: File
): Promise<PrescriptionUploadResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const key = crypto.randomUUID();
  const path = `${customerId}/${key}.${ext}`;
  const upload = await uploadToBucket(BUCKETS.prescriptions, path, file, {
    contentType: file.type || undefined,
  });
  if (!upload) return { ok: false, error: "upload failed" };

  const { data, error } = await sb
    .from("prescriptions")
    .insert({
      customer_id: customerId,
      image_path: upload.path,
      has_unclear: false,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };

  return { ok: true, prescriptionId: data.id, storagePath: upload.path };
}
