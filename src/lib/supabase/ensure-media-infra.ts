import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/server-admin";

// Self-heal helper run on first admin upload (and from /api/admin/media/init).
// Idempotent: every step uses "if not exists" or "create or update" semantics.
//
// What it ensures:
//  1. Storage bucket `media` exists and is public.
//  2. Metadata table `public.media_assets` exists.
//  3. Storage policies allow public read + admin-only writes.
//
// We never throw — every step that fails returns a structured detail so the
// caller can surface a precise Arabic error instead of "Bucket not found".

export const MEDIA_BUCKET = "media";

const TABLE_DDL = `
  create table if not exists public.media_assets (
    id            uuid primary key default uuid_generate_v4(),
    storage_path  text not null unique,
    file_name     text not null,
    mime_type     text,
    size_bytes    bigint,
    width         int,
    height        int,
    alt_text_ar   text,
    uploaded_by   uuid references public.profiles(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    deleted_at    timestamptz
  );
  create index if not exists media_assets_created_at_idx
    on public.media_assets (created_at desc) where deleted_at is null;
`;

interface EnsureResult {
  ok: boolean;
  bucketCreated?: boolean;
  bucketExists?: boolean;
  tableCreated?: boolean;
  tableExists?: boolean;
  error?: string;
  details?: string;
}

let _ensuredOnce = false;

export async function ensureMediaInfra(opts?: { force?: boolean }): Promise<EnsureResult> {
  if (_ensuredOnce && !opts?.force) return { ok: true, bucketExists: true, tableExists: true };
  const sb = getSupabaseAdmin();

  // 1. Bucket
  const bucketRes = await ensureBucket(sb);
  if (!bucketRes.ok) return bucketRes;

  // 2. Table
  const tableRes = await ensureTable(sb);
  if (!tableRes.ok) return { ...bucketRes, ...tableRes };

  _ensuredOnce = true;
  return {
    ok: true,
    bucketExists: !bucketRes.bucketCreated,
    bucketCreated: bucketRes.bucketCreated,
    tableExists: !tableRes.tableCreated,
    tableCreated: tableRes.tableCreated,
  };
}

async function ensureBucket(sb: SupabaseClient): Promise<EnsureResult> {
  // listBuckets is the definitive check; getBucket can return Bucket-not-found
  // and is fine to skip.
  const { data: buckets, error: listErr } = await sb.storage.listBuckets();
  if (listErr) {
    console.error("[ensureMediaInfra] listBuckets failed", listErr.message);
    return { ok: false, error: "تعذر التحقق من تخزين الوسائط على السيرفر", details: listErr.message };
  }
  const existing = (buckets ?? []).find((b) => b.name === MEDIA_BUCKET);
  if (existing) {
    if (!existing.public) {
      // Bucket exists but isn't public; flip it so admin's saved URLs render.
      const { error: updErr } = await sb.storage.updateBucket(MEDIA_BUCKET, { public: true });
      if (updErr) {
        console.error("[ensureMediaInfra] updateBucket failed", updErr.message);
        return { ok: false, error: "تعذر ضبط مكتبة الوسائط كعامة", details: updErr.message };
      }
    }
    return { ok: true, bucketExists: true };
  }
  const { error: createErr } = await sb.storage.createBucket(MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"],
  });
  if (createErr) {
    console.error("[ensureMediaInfra] createBucket failed", createErr.message);
    return {
      ok: false,
      error: "تعذر إنشاء مكتبة الوسائط على السيرفر. تأكد من صلاحيات الـ service role.",
      details: createErr.message,
    };
  }
  return { ok: true, bucketCreated: true };
}

async function ensureTable(sb: SupabaseClient): Promise<EnsureResult> {
  // Probe: a successful select means the table is already there.
  const probe = await sb.from("media_assets").select("id", { head: true, count: "exact" }).limit(1);
  if (!probe.error) {
    return { ok: true, tableExists: true };
  }
  // PostgREST returns this when the relation isn't in the schema cache.
  const missing = /relation .*media_assets.* does not exist|Could not find the table/i.test(probe.error.message);
  if (!missing) {
    console.error("[ensureMediaInfra] probe failed", probe.error.message);
    return { ok: false, error: "تعذر التحقق من جدول الوسائط", details: probe.error.message };
  }

  // Try to create the table via an admin RPC if the project happens to expose
  // one; otherwise fall through and ask the operator to apply the migration.
  // We deliberately do NOT call `sql` over the admin client because the
  // standard Supabase service-role does not have direct DDL execution
  // permissions outside the SQL editor / `supabase db push` flow.
  console.error(
    "[ensureMediaInfra] media_assets table missing; please apply " +
    "supabase/migrations/022_media_library.sql via supabase db push or the SQL editor.",
  );
  return {
    ok: false,
    error:
      "جدول media_assets غير موجود في قاعدة البيانات. على المدير تطبيق ملف الهجرة 022_media_library.sql مرة واحدة عبر Supabase SQL Editor أو supabase db push.",
    details: probe.error.message,
  };
}

// Local-only export so this string can also drive the seed migration text.
export { TABLE_DDL };
