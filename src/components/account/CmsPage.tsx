"use client";
import { useState } from "react";
import { Phone, MessageCircle, ChevronDown, FileText, HelpCircle } from "lucide-react";
import type { ContentPageSlug } from "@/lib/types";
import { useContentPage, useContentPages } from "@/lib/content-pages";
import { BackButton } from "@/components/ui/BackButton";

interface Props {
  slug: ContentPageSlug;
  onBack: () => void;
}

export function CmsPage({ slug, onBack }: Props) {
  const page = useContentPage(slug);
  // Pull the FAQ page in case the support page wants to link to it.
  const faqPage = useContentPages().find((p) => p.slug === "faq" && p.isActive) ?? null;

  if (!page || !page.isActive) {
    return (
      <Shell title="غير متاح" onBack={onBack}>
        <p className="text-sm text-gray-500 text-center py-10">المحتوى غير متاح حالياً.</p>
      </Shell>
    );
  }

  return (
    <Shell title={page.titleAr} onBack={onBack}>
      {slug === "support" ? (
        <SupportBody page={page} faqPage={faqPage} />
      ) : slug === "faq" ? (
        <FaqBody page={page} />
      ) : (
        <BodyText body={page.bodyAr} />
      )}
      <p className="text-[11px] text-gray-400 mt-6 text-center">
        آخر تحديث: {new Date(page.updatedAt).toLocaleDateString("ar-SY-u-nu-latn")}
      </p>
    </Shell>
  );
}

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 pb-4 bg-white border-b border-gray-100 safe-top-md">
        <BackButton onClick={onBack} />
        <h2 className="text-[15px] font-bold text-[#164E63] flex-1">{title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-10">
        {children}
      </div>
    </>
  );
}

function BodyText({ body }: { body: string }) {
  // Render a CMS-style paragraph block: split on double newlines for paragraphs,
  // single newlines become line breaks. Lists (lines starting with • or 1.) keep their character.
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <article className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm text-[#164E63] leading-7 whitespace-pre-line">{p}</p>
      ))}
    </article>
  );
}

function SupportBody({ page, faqPage }: { page: import("@/lib/types").ContentPage; faqPage: import("@/lib/types").ContentPage | null }) {
  const phone = page.supportPhone;
  const wa = page.supportWhatsapp;
  const [showFaq, setShowFaq] = useState(false);

  return (
    <div className="space-y-3">
      <article className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <p className="text-sm text-[#164E63] leading-7 whitespace-pre-line">{page.bodyAr}</p>
      </article>

      {(phone || wa) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {wa && (
            <a
              href={`https://wa.me/${wa.replace(/[^0-9]/g, "")}`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-4 active:bg-emerald-100 transition-colors"
            >
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                <MessageCircle size={18} className="text-[#059669]" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#164E63]">واتساب الدعم</p>
                <p className="text-[11px] text-gray-500 lat" dir="ltr">{wa}</p>
              </div>
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone.replace(/\s+/g, "")}`}
              className="flex items-center gap-3 bg-cyan-50 border border-cyan-100 rounded-xl p-4 active:bg-cyan-100 transition-colors"
            >
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                <Phone size={18} className="text-[#0891B2]" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#164E63]">هاتف الدعم</p>
                <p className="text-[11px] text-gray-500 lat" dir="ltr">{phone}</p>
              </div>
            </a>
          )}
        </div>
      )}

      {faqPage && (faqPage.faqItems?.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => setShowFaq((v) => !v)}
            className="w-full flex items-center gap-3 p-4 cursor-pointer text-start"
            aria-expanded={showFaq}
          >
            <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
              <HelpCircle size={16} className="text-[#0891B2]" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-[#164E63]">الأسئلة الشائعة</p>
              <p className="text-[11px] text-gray-400">قد تجد إجابتك مباشرة</p>
            </div>
            <ChevronDown size={16} className={`text-gray-400 transition-transform ${showFaq ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {showFaq && (
            <div className="border-t border-gray-100 p-4 space-y-3">
              {faqPage.faqItems!.map((it, i) => (
                <FaqItem key={i} q={it.q} a={it.a} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FaqBody({ page }: { page: import("@/lib/types").ContentPage }) {
  const items = page.faqItems ?? [];
  if (items.length === 0) {
    return (
      <article className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="text-sm text-gray-400 text-center py-6">لا توجد أسئلة مضافة حالياً.</p>
      </article>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <FaqItem key={i} q={it.q} a={it.a} />
      ))}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 p-3.5 cursor-pointer text-start"
        aria-expanded={open}
      >
        <FileText size={14} className="text-[#0891B2] flex-shrink-0" aria-hidden="true" />
        <p className="flex-1 text-sm font-semibold text-[#164E63]">{q}</p>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <p className="text-xs text-gray-600 leading-relaxed border-t border-gray-50 px-4 py-3">{a}</p>
      )}
    </div>
  );
}
