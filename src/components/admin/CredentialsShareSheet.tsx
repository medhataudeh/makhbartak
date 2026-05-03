"use client";
import { useMemo, useState } from "react";
import { Copy, MessageCircle, Mail, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Modal that surfaces the just-created account credentials and offers three
// hand-off paths: copy-to-clipboard, WhatsApp deep link, email deep link.
// The credentials never leave the admin's browser via the app — WhatsApp /
// email simply prefill the message; the admin still hits "send".
export interface ShareableCredentials {
  /** Display label, e.g. "ممرض" / "مستخدم مخبر". */
  roleLabel: string;
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  /** Optional URL to include in the share message. Defaults to the current
   *  origin so the recipient lands on a sensible login page. */
  loginUrl?: string;
}

function buildMessage(c: ShareableCredentials): string {
  const url = c.loginUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  return [
    `مرحباً ${c.fullName}،`,
    `تم إنشاء حسابك (${c.roleLabel}) في تطبيق مختبرك.`,
    "",
    "بيانات الدخول:",
    `البريد: ${c.email}`,
    `كلمة المرور: ${c.password}`,
    url ? `\nرابط الدخول: ${url}` : "",
    "",
    "يرجى تغيير كلمة المرور بعد أول تسجيل دخول.",
  ].filter(Boolean).join("\n");
}

function digits(phone: string | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  return cleaned.length >= 8 ? cleaned : null;
}

export function CredentialsShareSheet({
  credentials,
  onClose,
}: {
  credentials: ShareableCredentials;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"none" | "all" | "password">("none");
  const message = useMemo(() => buildMessage(credentials), [credentials]);

  const copy = async (text: string, kind: "all" | "password") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied("none"), 2500);
    } catch {
      // Older Safari without permissions API: fall back to a textarea select.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(kind); } catch { /* noop */ }
      document.body.removeChild(ta);
      window.setTimeout(() => setCopied("none"), 2500);
    }
  };

  const wa = digits(credentials.phone);
  const whatsappHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null;
  const mailtoHref = `mailto:${encodeURIComponent(credentials.email)}?subject=${encodeURIComponent("بيانات الدخول إلى مختبرك")}&body=${encodeURIComponent(message)}`;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-[#164E63]">تم إنشاء الحساب</h3>
          <p className="text-[12px] text-gray-500 mt-1">شارك بيانات الدخول مع {credentials.fullName}.</p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-[12px] space-y-1.5">
          <Row label="الدور"        value={credentials.roleLabel} />
          <Row label="الاسم"        value={credentials.fullName} />
          <Row label="البريد"       value={credentials.email} ltr />
          <Row label="كلمة المرور"  value={credentials.password} ltr />
          {credentials.phone && <Row label="الهاتف" value={credentials.phone} ltr />}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline" size="md"
            onClick={() => copy(message, "all")}
            aria-live="polite"
          >
            {copied === "all" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied === "all" ? "تم النسخ" : "نسخ الرسالة"}
          </Button>
          <Button
            variant="outline" size="md"
            onClick={() => copy(credentials.password, "password")}
          >
            {copied === "password" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied === "password" ? "تم النسخ" : "نسخ كلمة المرور"}
          </Button>

          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-[#25D366] text-white text-sm font-semibold cursor-pointer active:opacity-90"
            >
              <MessageCircle size={14} aria-hidden="true" />
              واتساب
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="رقم الهاتف غير متوفر"
              className="inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-gray-100 text-gray-400 text-sm font-semibold cursor-not-allowed"
            >
              <MessageCircle size={14} aria-hidden="true" />
              واتساب
            </button>
          )}

          <a
            href={mailtoHref}
            className="inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer active:opacity-90"
          >
            <Mail size={14} aria-hidden="true" />
            بريد إلكتروني
          </a>
        </div>

        <p className="text-[11px] text-amber-600 leading-relaxed">
          لن يتم عرض كلمة المرور مرة أخرى. أرسلها الآن لمستلم الحساب أو احفظها في مكان آمن.
        </p>

        <div className="flex justify-end pt-1">
          <Button variant="primary" onClick={onClose}>تم</Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-gray-500 text-[11px]">{label}</span>
      <span className={`text-[#164E63] font-semibold break-all text-end ${ltr ? "lat" : ""}`} dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}

// Simple, memorable, ≥8-char password generator. The set excludes look-alikes
// (0/O, l/1) so admins can read it aloud without confusion.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateTempPassword(len = 10): string {
  const chars: string[] = [];
  for (let i = 0; i < len; i++) {
    chars.push(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
  }
  // Guarantee at least one uppercase + one digit (the lab portal's policy
  // and Supabase auth's defaults both expect mixed strength).
  if (!/[A-Z]/.test(chars.join(""))) chars[0] = "A";
  if (!/[0-9]/.test(chars.join(""))) chars[1] = "7";
  return chars.join("");
}
