"use client";

// Phase 9 — admin media library client wrappers. The browser never touches
// the service-role client; uploads go through /api/admin/media as multipart
// FormData and the server signs them with the admin client.

export interface MediaAsset {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  altTextAr: string | null;
  publicUrl: string;
  createdAt: string;
}

interface RawMediaRow {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  alt_text_ar: string | null;
  public_url: string;
  created_at: string;
}

function map(row: RawMediaRow): MediaAsset {
  return {
    id: row.id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    altTextAr: row.alt_text_ar,
    publicUrl: row.public_url,
    createdAt: row.created_at,
  };
}

export async function listMedia(): Promise<MediaAsset[]> {
  const res = await fetch("/api/admin/media", { cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body.assets) ? (body.assets as RawMediaRow[]).map(map) : [];
}

export async function uploadMedia(
  file: File,
  altTextAr?: string,
): Promise<{ ok: boolean; asset?: MediaAsset; error?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (altTextAr) fd.append("altTextAr", altTextAr);
  const res = await fetch("/api/admin/media", { method: "POST", body: fd });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  }
  const body = await res.json();
  return { ok: true, asset: map(body.asset as RawMediaRow) };
}

export async function deleteMedia(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function patchMediaAlt(
  id: string,
  altTextAr: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ altTextAr }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}
