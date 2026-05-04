"use client";
import { useState } from "react";
import Image from "next/image";
import { ImageIcon, Palette, Save, RotateCcw, FlaskConical, Bell } from "lucide-react";
import type { BrandingConfig, AdminRole } from "@/lib/types";
import { useBranding, setBranding, DEFAULT_BRANDING } from "@/lib/branding";
import { logActivity } from "@/lib/activity-log";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface Props {
  adminId: string;
  adminName: string;
  adminRole: AdminRole;
}

export function BrandingAdmin({ adminId, adminName, adminRole }: Props) {
  const live = useBranding();
  const toast = useToast();
  const [draft, setDraft] = useState<BrandingConfig>(live);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(live);

  const setLogo = <K extends keyof BrandingConfig["logos"]>(k: K, v: string) =>
    setDraft((d) => ({ ...d, logos: { ...d.logos, [k]: v } }));
  const setTheme = <K extends keyof BrandingConfig["theme"]>(k: K, v: string) =>
    setDraft((d) => ({ ...d, theme: { ...d.theme, [k]: v } }));
  const setBg = (v: BrandingConfig["background"]) =>
    setDraft((d) => ({ ...d, background: v }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await setBranding(draft);
      if (!r.ok) { toast.error(r.error ?? "تعذر حفظ الهوية البصرية"); return; }
      logActivity({
        adminId, adminName, role: adminRole,
        action: "settings_change", entity: "branding", entityId: "global",
        details: "تحديث الشعارات/الهوية",
      });
      toast.success("تم الحفظ بنجاح");
    } finally {
      setSaving(false);
    }
  };

  const restore = () => {
    setDraft(DEFAULT_BRANDING);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-[#164E63]">الشعارات والهوية البصرية</h2>
          <p className="text-xs text-gray-500 mt-0.5">إدارة شعارات التطبيق وألوان الهوية. تُحفظ في قاعدة البيانات وتظهر فوراً في جميع البوابات.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={restore} disabled={!dirty && JSON.stringify(live) === JSON.stringify(DEFAULT_BRANDING)}>
            <RotateCcw size={13} aria-hidden="true" />
            استعادة الافتراضي
          </Button>
          <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={!dirty || saving}>
            <Save size={13} aria-hidden="true" />
            حفظ التغييرات
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="ألوان الهوية" icon={<Palette size={14} aria-hidden="true" />}>
          <ColorRow label="اللون الأساسي" value={draft.theme.primary} onChange={(v) => setTheme("primary", v)} />
          <ColorRow label="لون الإجراء (CTA)" value={draft.theme.cta} onChange={(v) => setTheme("cta", v)} />
          <ColorRow label="اللون الناعم" value={draft.theme.accent} onChange={(v) => setTheme("accent", v)} />
          <Field label="نمط الخلفية">
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(["soft-mesh", "subtle-shapes", "plain"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setBg(v)}
                  aria-pressed={draft.background === v}
                  className={`text-[11px] py-2 rounded-lg border-2 cursor-pointer transition-colors ${
                    draft.background === v ? "border-[#0891B2] bg-[#ECFEFF] text-[#0891B2]" : "border-gray-200 bg-white text-gray-500"
                  }`}
                >
                  {v === "soft-mesh" ? "متدرّج ناعم" : v === "subtle-shapes" ? "أشكال خفيفة" : "سادة"}
                </button>
              ))}
            </div>
          </Field>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <Card title="شعارات التطبيق الأساسية" icon={<ImageIcon size={14} aria-hidden="true" />}>
            <LogoRow label="الشعار الرئيسي" value={draft.logos.main} onChange={(v) => setLogo("main", v)} size={56} />
            <LogoRow label="شعار الهيدر" value={draft.logos.header} onChange={(v) => setLogo("header", v)} size={36} />
            <LogoRow label="شعار الموبايل" value={draft.logos.mobile} onChange={(v) => setLogo("mobile", v)} size={48} />
            <LogoRow label="شعار سطح المكتب" value={draft.logos.desktop} onChange={(v) => setLogo("desktop", v)} size={56} />
            <LogoRow label="شعار النمط الفاتح" value={draft.logos.light} onChange={(v) => setLogo("light", v)} size={48} />
            <LogoRow label="شعار النمط الداكن (اختياري)" value={draft.logos.dark ?? ""} onChange={(v) => setLogo("dark", v)} size={48} dark />
          </Card>

          <Card title="أيقونات النظام" icon={<ImageIcon size={14} aria-hidden="true" />}>
            <LogoRow label="Favicon" value={draft.logos.favicon} onChange={(v) => setLogo("favicon", v)} size={32} />
            <LogoRow label="أيقونة PWA" value={draft.logos.pwaIcon} onChange={(v) => setLogo("pwaIcon", v)} size={48} />
          </Card>

          <Card title="شعارات البوابات" icon={<ImageIcon size={14} aria-hidden="true" />}>
            <LogoRow label="لوحة الإدارة" value={draft.logos.adminDashboard} onChange={(v) => setLogo("adminDashboard", v)} size={48} />
            <LogoRow label="تطبيق الممرض" value={draft.logos.nurseInterface ?? ""} onChange={(v) => setLogo("nurseInterface", v)} size={48} />
            <LogoRow label="بوابة المخبر" value={draft.logos.labPortal ?? ""} onChange={(v) => setLogo("labPortal", v)} size={48} />
          </Card>
        </div>
      </div>

      {/* Live preview — header strip and primary button */}
      <Card title="معاينة" icon={<ImageIcon size={14} aria-hidden="true" />}>
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100" style={{ background: draft.theme.accent }}>
            <div className="flex items-center gap-2.5">
              {draft.logos.header ? (
                <div className="w-9 h-9 rounded-lg overflow-hidden bg-white relative">
                  <Image src={draft.logos.header} alt="" fill sizes="36px" className="object-cover" />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: draft.theme.primary }}>
                  <FlaskConical size={18} className="text-white" aria-hidden="true" />
                </div>
              )}
              <span className="text-base font-bold" style={{ color: draft.theme.primary }}>مختبرك</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="w-9 h-9 rounded-lg bg-white flex items-center justify-center" aria-label="إشعارات">
                <Bell size={16} style={{ color: draft.theme.primary }} aria-hidden="true" />
              </button>
              <button
                className="px-4 py-2 rounded-lg text-white text-xs font-semibold"
                style={{ background: draft.theme.cta }}
              >
                إجراء أساسي
              </button>
            </div>
          </div>
          <div className="p-4 bg-white">
            <p className="text-sm font-semibold" style={{ color: draft.theme.primary }}>عنوان مثال</p>
            <p className="text-xs text-gray-500 mt-1">هذا نص توضيحي يستخدم نفس ألوان الهوية المختارة أعلاه.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Local helpers ───────────────────────────────────────────────────────────
function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
        <h4 className="text-xs font-bold text-[#164E63] flex items-center gap-1.5">{icon}{title}</h4>
      </header>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer flex-shrink-0" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
      </div>
    </Field>
  );
}

function LogoRow({ label, value, onChange, size, dark }: { label: string; value: string; onChange: (v: string) => void; size: number; dark?: boolean }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <div
          className="rounded-lg overflow-hidden border border-gray-200 flex-shrink-0 relative"
          style={{ width: size, height: size, background: dark ? "#0E1A24" : "#F9FAFB" }}
        >
          {value ? (
            <Image src={value} alt="" fill sizes={`${size}px`} className="object-cover" />
          ) : (
            <ImageIcon size={size * 0.4} className={`absolute inset-0 m-auto ${dark ? "text-white/40" : "text-gray-300"}`} aria-hidden="true" />
          )}
        </div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… أو /path/to/logo.png"
          className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm lat"
          dir="ltr"
        />
      </div>
    </Field>
  );
}
