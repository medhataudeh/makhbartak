"use client";
import { useState } from "react";
import { FileText, Shield, LifeBuoy, HelpCircle, Save, Plus, Trash2 } from "lucide-react";
import type { ContentPage, ContentPageSlug, AdminRole } from "@/lib/types";
import { useContentPages, updateContentPage } from "@/lib/content-pages";
import { logActivity } from "@/lib/activity-log";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

interface Props {
  adminId: string;
  adminName: string;
  adminRole: AdminRole;
}

const SLUG_META: Record<ContentPageSlug, { label: string; Icon: React.FC<{ size?: number; className?: string }> }> = {
  terms:   { label: "الشروط والأحكام",  Icon: FileText },
  privacy: { label: "سياسة الخصوصية",   Icon: Shield },
  support: { label: "الدعم",            Icon: LifeBuoy },
  faq:     { label: "الأسئلة الشائعة",  Icon: HelpCircle },
};

export function ContentAdmin({ adminId, adminName, adminRole }: Props) {
  const pages = useContentPages();
  const [activeSlug, setActiveSlug] = useState<ContentPageSlug>("terms");
  const active = pages.find((p) => p.slug === activeSlug)!;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-[#164E63]">محتوى الصفحات</h2>
        <p className="text-xs text-gray-500 mt-0.5">تظهر للعميل في تطبيق العملاء وعلى البوابة. التغييرات تُحفظ مباشرة.</p>
      </div>

      <div className="flex gap-1 px-1 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {(Object.keys(SLUG_META) as ContentPageSlug[]).map((slug) => {
          const meta = SLUG_META[slug];
          const isActive = slug === activeSlug;
          return (
            <button
              key={slug}
              onClick={() => setActiveSlug(slug)}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                isActive ? "border-[#0891B2] text-[#0891B2]" : "border-transparent text-gray-500 hover:text-[#164E63]"
              }`}
            >
              <meta.Icon size={13} className={isActive ? "text-[#0891B2]" : "text-gray-400"} />
              {meta.label}
            </button>
          );
        })}
      </div>

      {activeSlug === "faq"
        ? <FaqEditor key={active.id} page={active} adminId={adminId} adminName={adminName} adminRole={adminRole} />
        : <PageEditor key={active.id} page={active} adminId={adminId} adminName={adminName} adminRole={adminRole} />}
    </div>
  );
}

function PageEditor({ page, adminId, adminName, adminRole }: { page: ContentPage; adminId: string; adminName: string; adminRole: AdminRole }) {
  const toast = useToast();
  const [title, setTitle] = useState(page.titleAr);
  const [body, setBody] = useState(page.bodyAr);
  const [supportPhone, setSupportPhone] = useState(page.supportPhone ?? "");
  const [supportWhatsapp, setSupportWhatsapp] = useState(page.supportWhatsapp ?? "");
  const [isActive, setIsActive] = useState(page.isActive);
  const [saving, setSaving] = useState(false);
  const isSupport = page.slug === "support";

  const dirty =
    title !== page.titleAr ||
    body !== page.bodyAr ||
    isActive !== page.isActive ||
    supportPhone !== (page.supportPhone ?? "") ||
    supportWhatsapp !== (page.supportWhatsapp ?? "");

  const save = async () => {
    setSaving(true);
    try {
      // Phase 3.8 P1: real await + Arabic error toast on failure.
      const r = await updateContentPage(page.slug, {
        titleAr: title,
        bodyAr: body,
        isActive,
        ...(isSupport ? {
          supportPhone: supportPhone.trim() || undefined,
          supportWhatsapp: supportWhatsapp.trim() || undefined,
        } : {}),
      });
      if (!r.ok) { toast.error(r.error ?? "تعذر حفظ المحتوى"); return; }
      logActivity({
        adminId, adminName, role: adminRole,
        action: "settings_change", entity: "content_page", entityId: page.slug,
        details: `تعديل محتوى صفحة "${SLUG_META[page.slug].label}"`,
      });
      toast.success("تم الحفظ بنجاح");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <Field label="العنوان">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-[#164E63] py-2">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4" />
          نشطة (تظهر للعميل)
        </label>
        {isSupport && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="هاتف الدعم">
              <input value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="+963 11 200 0000" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
            </Field>
            <Field label="واتساب الدعم">
              <input value={supportWhatsapp} onChange={(e) => setSupportWhatsapp(e.target.value)} placeholder="+963 911 000 000" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
            </Field>
          </div>
        )}
      </Card>

      <Card>
        <Field label="المحتوى">
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)} rows={14}
            className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-y leading-7"
            placeholder="اكتب المحتوى هنا. اترك سطراً فارغاً بين الفقرات."
          />
          <p className="text-[11px] text-gray-400 mt-1">يدعم الفقرات (سطر فارغ بين كل فقرة) وقوائم نقطية بسيطة.</p>
        </Field>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <p className="text-[11px] text-gray-400 me-2">آخر تحديث: {new Date(page.updatedAt).toLocaleString("ar-SY-u-nu-latn")}</p>
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={save}>
          <Save size={13} aria-hidden="true" /> حفظ التغييرات
        </Button>
      </div>
    </div>
  );
}

function FaqEditor({ page, adminId, adminName, adminRole }: { page: ContentPage; adminId: string; adminName: string; adminRole: AdminRole }) {
  const toast = useToast();
  const [items, setItems] = useState(() => page.faqItems ?? []);
  const [isActive, setIsActive] = useState(page.isActive);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(items) !== JSON.stringify(page.faqItems ?? []) || isActive !== page.isActive;

  const save = async () => {
    setSaving(true);
    try {
      const r = await updateContentPage("faq", { faqItems: items, isActive });
      if (!r.ok) { toast.error(r.error ?? "تعذر حفظ الأسئلة"); return; }
      logActivity({
        adminId, adminName, role: adminRole,
        action: "settings_change", entity: "content_page", entityId: "faq",
        details: "تعديل الأسئلة الشائعة",
      });
      toast.success("تم الحفظ بنجاح");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <label className="flex items-center gap-2 text-sm text-[#164E63]">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4" />
          نشطة
        </label>
      </Card>

      {items.map((item, i) => (
        <Card key={i}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-[11px] text-gray-400 font-medium">سؤال #{i + 1}</p>
            <button
              onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              aria-label="حذف"
              className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer"
            >
              <Trash2 size={13} className="text-red-400" aria-hidden="true" />
            </button>
          </div>
          <Field label="السؤال">
            <input
              value={item.q}
              onChange={(e) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, q: e.target.value } : x))}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none"
            />
          </Field>
          <Field label="الإجابة">
            <textarea
              value={item.a}
              onChange={(e) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, a: e.target.value } : x))}
              rows={3}
              className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none resize-y"
            />
          </Field>
        </Card>
      ))}

      <button
        onClick={() => setItems((prev) => [...prev, { q: "", a: "" }])}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-[#0891B2] text-sm font-semibold cursor-pointer active:bg-gray-50"
      >
        <Plus size={15} aria-hidden="true" /> إضافة سؤال جديد
      </button>

      <div className="flex items-center justify-end gap-2">
        <p className="text-[11px] text-gray-400 me-2">آخر تحديث: {new Date(page.updatedAt).toLocaleString("ar-SY-u-nu-latn")}</p>
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty || items.some((it) => !it.q.trim() || !it.a.trim())} onClick={save}>
          <Save size={13} aria-hidden="true" /> حفظ التغييرات
        </Button>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">{children}</section>
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
