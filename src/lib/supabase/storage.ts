"use client";
import { getSupabaseBrowser } from "./client";

// Bucket names match the SQL in supabase/migrations/005_storage_buckets.sql.
export const BUCKETS = {
  publicAssets: "public-assets",
  nursePhotos: "nurse-photos",
  labBranding: "lab-branding",
  prescriptions: "prescriptions",
  labResults: "lab-results",
} as const;

export type BucketId = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface UploadResult {
  path: string;
  publicUrl?: string;
}

/**
 * Upload a file to a Supabase Storage bucket. Returns null when Supabase
 * isn't configured so callers can fall back to data:URL / local handling.
 *
 * Path conventions (enforced by RLS):
 *   prescriptions  → <customer_id>/<filename>
 *   lab-results    → <order_id>/<filename>
 *   nurse-photos   → <profile_id>/<filename>
 *   lab-branding   → <lab_id>/<filename>
 *   public-assets  → free-form
 */
export async function uploadToBucket(
  bucket: BucketId,
  path: string,
  file: File | Blob,
  options: { upsert?: boolean; contentType?: string } = {}
): Promise<UploadResult | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const { error } = await sb.storage.from(bucket).upload(path, file, {
    upsert: options.upsert ?? false,
    contentType: options.contentType,
  });
  if (error) {
    console.warn(`[supabase] upload to ${bucket}/${path} failed`, error);
    return null;
  }
  // Public buckets get a stable URL; private buckets need a signed URL on read.
  const isPublic =
    bucket === BUCKETS.publicAssets ||
    bucket === BUCKETS.nursePhotos ||
    bucket === BUCKETS.labBranding;
  if (isPublic) {
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return { path, publicUrl: data.publicUrl };
  }
  return { path };
}

/**
 * Generate a short-lived signed URL for a private bucket object.
 * Returns null when Supabase isn't configured or the call fails.
 */
export async function signedUrl(
  bucket: BucketId,
  path: string,
  expiresInSeconds = 60 * 10
): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    console.warn(`[supabase] signedUrl ${bucket}/${path} failed`, error);
    return null;
  }
  return data.signedUrl;
}
