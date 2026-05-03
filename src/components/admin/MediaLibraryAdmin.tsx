"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { listMedia, uploadMedia, deleteMedia, type MediaAsset } from "@/lib/admin-media-api";

// Top-level "مكتبة الوسائط" section in the admin dashboard. Distinct from
// the inline MediaPicker — this is the manage view: bulk upload, search,
// copy URL, delete.
export function MediaLibraryAdmin() {
  const toast = useToast();
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listMedia();
      if (!cancelled) { setItems(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = search
    ? items.filter((a) => a.fileName.toLowerCase().includes(search.toLowerCase()))
    : items;

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const next: MediaAsset[] = [];
    for (const file of Array.from(files)) {
      const r = await uploadMedia(file);
      if (!r.ok || !r.asset) {
        toast.error(`${file.name}: ${r.error ?? "تعذر الرفع"}`);
        continue;
      }
      next.push(r.asset);
    }
    setUploading(false);
    if (next.length > 0) {
      setItems((prev) => [...next, ...prev]);
      toast.success(`تم رفع ${next.length} ملف${next.length === 1 ? "" : "ات"}`);
    }
  };

  const onDelete = async (a: MediaAsset) => {
    if (!window.confirm(`حذف ${a.fileName}؟`)) return;
    const r = await deleteMedia(a.id);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
    setItems((prev) => prev.filter((x) => x.id !== a.id));
    toast.success("تم الحذف");
  };

  const onCopy = async (a: MediaAsset) => {
    try {
      await navigator.clipboard.writeText(a.publicUrl);
      setCopiedId(a.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">{items.length} ملف</p>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم الملف"
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs"
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => { void onUpload(e.target.files); e.target.value = ""; }}
          />
          <Button
            size="sm"
            variant="primary"
            loading={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={13} aria-hidden="true" />
            رفع صور
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 text-center py-12">جاري التحميل…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-8 text-center">
          <p className="text-sm font-bold text-[#164E63] mb-1">لا توجد صور بعد</p>
          <p className="text-xs text-gray-500 leading-relaxed mb-4">ارفع أول صورة لاستخدامها في الباقات والسلايدر.</p>
          <Button size="sm" variant="primary" onClick={() => fileInput.current?.click()}>
            <Upload size={13} aria-hidden="true" />
            رفع صورة
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((a) => (
            <article key={a.id} className="rounded-xl border border-gray-100 overflow-hidden bg-white">
              <a href={a.publicUrl} target="_blank" rel="noopener noreferrer" className="block aspect-square bg-gray-50 relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.publicUrl} alt={a.altTextAr ?? a.fileName} className="w-full h-full object-cover" />
              </a>
              <div className="p-2 space-y-1.5">
                <p className="text-[11px] text-gray-500 truncate" dir="ltr">{a.fileName}</p>
                {a.sizeBytes != null && (
                  <p className="text-[10px] text-gray-400 lat" dir="ltr">{formatSize(a.sizeBytes)}</p>
                )}
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => onCopy(a)}>
                    {copiedId === a.id ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                    {copiedId === a.id ? "نُسخ" : "نسخ"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => onDelete(a)}
                    aria-label="حذف"
                    className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 size={12} className="text-red-400" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
