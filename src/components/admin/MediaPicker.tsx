"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Upload, Image as ImageIcon, ExternalLink, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { listMedia, uploadMedia, deleteMedia, type MediaAsset } from "@/lib/admin-media-api";

interface MediaPickerProps {
  /** Current persisted URL (may be a Supabase media URL, an external URL,
   *  or empty). The component never restricts what you can save — it just
   *  makes uploading + reusing media one tap. */
  value: string;
  onChange: (url: string) => void;
  /** Optional label rendered above the field. */
  label?: string;
  /** Set to true on small surfaces (e.g. inside narrow modals). */
  compact?: boolean;
}

export function MediaPicker({ value, onChange, label, compact = false }: MediaPickerProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      {label && <p className="text-[11px] text-gray-500 font-medium">{label}</p>}

      <div className={`flex ${compact ? "flex-col" : "flex-row"} items-stretch gap-2`}>
        {/* Preview */}
        <div className="w-20 h-20 flex-shrink-0 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }} />
          ) : (
            <ImageIcon size={20} className="text-gray-300" aria-hidden="true" />
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                const r = await uploadMedia(f);
                setBusy(false);
                e.target.value = "";
                if (!r.ok || !r.asset) { toast.error(r.error ?? "تعذر رفع الصورة"); return; }
                onChange(r.asset.publicUrl);
                toast.success("تم رفع الصورة");
              }}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => fileInput.current?.click()}
              loading={busy}
              type="button"
            >
              <Upload size={13} aria-hidden="true" />
              رفع
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} type="button">
              <ImageIcon size={13} aria-hidden="true" />
              من المكتبة
            </Button>
            {value && (
              <Button size="sm" variant="ghost" onClick={() => onChange("")} type="button">
                إزالة
              </Button>
            )}
          </div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="رابط خارجي اختياري"
            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs lat"
            dir="ltr"
          />
        </div>
      </div>

      {open && <MediaLibraryDialog onClose={() => setOpen(false)} onPick={(asset) => { onChange(asset.publicUrl); setOpen(false); }} />}
    </div>
  );
}

function MediaLibraryDialog({ onClose, onPick }: { onClose: () => void; onPick: (a: MediaAsset) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl max-h-[80vh] rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-[#164E63]">مكتبة الوسائط</h3>
          <button onClick={onClose} aria-label="إغلاق" className="text-gray-400 hover:text-[#164E63] cursor-pointer">×</button>
        </div>
        <div className="px-4 py-2 border-b border-gray-100">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم الملف"
            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-xs text-gray-400 text-center py-8">جاري التحميل…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">لا توجد صور بعد. ارفع من &quot;مكتبة الوسائط&quot;.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map((a) => (
                <article key={a.id} className="rounded-xl border border-gray-100 overflow-hidden bg-white">
                  <div className="aspect-square bg-gray-50 relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.publicUrl} alt={a.altTextAr ?? a.fileName} className="w-full h-full object-cover" />
                  </div>
                  <div className="p-2 space-y-1.5">
                    <p className="text-[11px] text-gray-500 truncate" dir="ltr">{a.fileName}</p>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="primary" className="flex-1" onClick={() => onPick(a)}>
                        <Check size={12} aria-hidden="true" />
                        اختيار
                      </Button>
                      <a
                        href={a.publicUrl} target="_blank" rel="noopener noreferrer"
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center cursor-pointer"
                        aria-label="فتح الرابط"
                      >
                        <ExternalLink size={12} className="text-gray-500" aria-hidden="true" />
                      </a>
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={async () => {
                          if (!window.confirm(`حذف ${a.fileName}؟`)) return;
                          setBusyId(a.id);
                          const r = await deleteMedia(a.id);
                          setBusyId(null);
                          if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
                          setItems((prev) => prev.filter((x) => x.id !== a.id));
                        }}
                        aria-label="حذف"
                        className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-red-50 flex items-center justify-center cursor-pointer disabled:opacity-50"
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
      </div>
    </div>
  );
}

// Small helper for direct usage in admin pages — same component without the
// containing form-field shell (used by the Media Library section).
export { MediaLibraryDialog };

// Image fallback wrapper used by customer surfaces. Renders a grey
// placeholder when the URL is empty or fails to load. Drop in anywhere a
// next/image breaks because the URL is missing.
export function MediaImage({
  src, alt, fill, className, sizes, priority,
}: {
  src: string | undefined;
  alt: string;
  fill?: boolean;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className ?? ""}`}>
        <ImageIcon size={20} className="text-gray-300" aria-hidden="true" />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill={fill}
      className={className}
      sizes={sizes}
      priority={priority}
      onError={() => setErr(true)}
    />
  );
}
