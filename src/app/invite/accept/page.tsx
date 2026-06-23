"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  FlaskConical, Lock, Eye, EyeOff, AlertCircle, CheckCircle2,
  ShieldCheck, Building2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { applyNewPassword } from "@/lib/auth";
import {
  type InvitationPublic, type InviteTargetRole,
  PORTAL_LABELS, PLATFORM_NAME_AR, inviteRoleLabel, invitePermissionSummary,
} from "@/lib/invitation";

const PORTAL_PATH: Record<InviteTargetRole, string> = {
  admin: "/admin", lab: "/lab", nurse: "/nurse", customer: "/",
};

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("ar-SY-u-nu-latn", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return null; }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-[#0891B2] flex items-center justify-center">
            <FlaskConical size={22} className="text-white" aria-hidden="true" />
          </div>
          <span className="text-lg font-bold text-[#164E63]">{PLATFORM_NAME_AR}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}
      className="bg-white rounded-2xl border border-gray-100 p-6"
    >
      {children}
    </motion.div>
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card>
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-[#ECFEFF] flex items-center justify-center">{icon}</div>
        <p className="text-base font-bold text-[#164E63]">{title}</p>
        <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
      </div>
    </Card>
  );
}

function AcceptInner() {
  const params = useSearchParams();
  const invitationId = params.get("invitation");

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<InvitationPublic | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [doneRole, setDoneRole] = useState<InviteTargetRole | null>(null);

  // Resolve the Supabase session the invite link established.
  useEffect(() => {
    let cancelled = false;
    const sb = getSupabaseBrowser();
    if (!sb) {
      // Defer off the effect body so we never setState synchronously.
      void Promise.resolve().then(() => { if (!cancelled) setSessionReady(true); });
      return () => { cancelled = true; };
    }
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      setSessionEmail(session?.user?.email ?? null);
      setSessionReady(true);
    });
    void sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSessionEmail(data.session?.user?.email ?? null);
      setSessionReady(true);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  // Fetch display-safe invitation details (no session required).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!invitationId) { if (!cancelled) setLoading(false); return; }
      try {
        const res = await fetch(`/api/invitations/${invitationId}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) { setNotFound(true); return; }
        const body = await res.json();
        setInvitation(body.invitation as InvitationPublic);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [invitationId]);

  const onSubmit = useCallback(async () => {
    setError("");
    if (password.length < 8) { setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل"); return; }
    if (password !== confirm) { setError("كلمتا المرور غير متطابقتين"); return; }
    if (!invitationId) return;
    setSubmitting(true);
    // 1. Set the account password on the session the invite link created.
    const pw = await applyNewPassword(password);
    if (!pw.ok) { setError("تعذر تعيين كلمة المرور. حاول فتح الرابط من جديد."); setSubmitting(false); return; }
    // 2. Finalize the invitation server-side (assigns role, idempotent).
    try {
      const res = await fetch(`/api/invitations/${invitationId}/accept`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? "تعذر قبول الدعوة"); setSubmitting(false); return; }
      setDoneRole((body.targetRole ?? invitation?.targetRole ?? "customer") as InviteTargetRole);
    } catch {
      setError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
      setSubmitting(false);
    }
  }, [password, confirm, invitationId, invitation]);

  if (loading) {
    return <Shell><Card><div className="h-24 flex items-center justify-center text-sm text-gray-400">جارٍ تحميل الدعوة…</div></Card></Shell>;
  }

  // Success.
  if (doneRole) {
    return (
      <Shell>
        <Notice
          icon={<CheckCircle2 size={28} className="text-[#059669]" aria-hidden="true" />}
          title="تم قبول الدعوة بنجاح"
          body="تم تفعيل حسابك وتعيين كلمة المرور. يمكنك الآن الدخول إلى المنصة."
        />
        <div className="mt-4">
          <Button variant="primary" size="lg" className="w-full" type="button"
            onClick={() => { window.location.href = PORTAL_PATH[doneRole]; }}>
            المتابعة إلى المنصة
          </Button>
        </div>
      </Shell>
    );
  }

  // Missing metadata — don't crash; offer a generic continue.
  if (!invitationId) {
    return (
      <Shell>
        <Notice
          icon={<AlertCircle size={28} className="text-[#0891B2]" aria-hidden="true" />}
          title="رابط دعوة غير مكتمل"
          body="لم نتمكن من قراءة تفاصيل الدعوة. إن كنت قد سجّلت الدخول يمكنك المتابعة إلى المنصة، وإلا اطلب رابط دعوة جديداً."
        />
        <div className="mt-4">
          <Button variant="outline" size="lg" className="w-full" type="button"
            onClick={() => { window.location.href = "/"; }}>
            الذهاب إلى الصفحة الرئيسية
          </Button>
        </div>
      </Shell>
    );
  }

  if (notFound || !invitation) {
    return <Shell><Notice icon={<AlertCircle size={28} className="text-gray-400" aria-hidden="true" />} title="الدعوة غير موجودة" body="الرابط غير صالح أو تم حذف الدعوة. تواصل مع من أرسل لك الدعوة." /></Shell>;
  }

  if (invitation.status === "expired" || invitation.isExpired) {
    return <Shell><Notice icon={<Clock size={28} className="text-amber-500" aria-hidden="true" />} title="انتهت صلاحية الدعوة" body="انتهت مدة صلاحية هذه الدعوة. اطلب من الإدارة إرسال دعوة جديدة." /></Shell>;
  }
  if (invitation.status === "revoked") {
    return <Shell><Notice icon={<AlertCircle size={28} className="text-rose-500" aria-hidden="true" />} title="تم إلغاء الدعوة" body="لم تعد هذه الدعوة صالحة. تواصل مع الإدارة لمزيد من المعلومات." /></Shell>;
  }
  if (invitation.status === "accepted") {
    return (
      <Shell>
        <Notice icon={<CheckCircle2 size={28} className="text-[#059669]" aria-hidden="true" />} title="تم قبول هذه الدعوة مسبقاً" body="حسابك مفعّل بالفعل. يمكنك تسجيل الدخول مباشرة." />
        <div className="mt-4">
          <Button variant="primary" size="lg" className="w-full" type="button"
            onClick={() => { window.location.href = PORTAL_PATH[invitation.targetRole]; }}>
            تسجيل الدخول
          </Button>
        </div>
      </Shell>
    );
  }

  // Pending. Detect session/email mismatch.
  const emailMismatch =
    sessionReady && sessionEmail != null &&
    sessionEmail.trim().toLowerCase() !== invitation.email.trim().toLowerCase();

  const portal = PORTAL_LABELS[invitation.targetRole];
  const roleLabel = inviteRoleLabel(invitation);
  const summary = invitePermissionSummary(invitation);
  const expiry = formatExpiry(invitation.expiresAt);

  return (
    <Shell>
      <Card>
        <p className="text-base font-bold text-[#164E63] mb-1">دعوة للانضمام إلى بوابة {portal}</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-4">
          {invitation.invitedByName ? <><strong className="text-[#164E63]">{invitation.invitedByName}</strong> دعاك</> : "تمت دعوتك"} للانضمام إلى منصة {PLATFORM_NAME_AR}.
        </p>

        <div className="rounded-xl bg-[#F8FAFC] border border-gray-100 p-3.5 space-y-2 text-sm">
          <Row label="البريد"><span dir="ltr">{invitation.email}</span></Row>
          <Row label="البوابة">{portal}</Row>
          <Row label="الدور">{roleLabel}</Row>
          {expiry && <Row label="صالحة حتى">{expiry}</Row>}
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#164E63] mb-2">
            <ShieldCheck size={15} aria-hidden="true" /> الصلاحيات
          </div>
          <ul className="space-y-1.5">
            {summary.map((s, i) => (
              <li key={i} className="text-sm text-gray-600 flex gap-2 leading-relaxed">
                <span className="text-[#0891B2] mt-1.5 w-1 h-1 rounded-full bg-[#0891B2] shrink-0" aria-hidden="true" />{s}
              </li>
            ))}
          </ul>
        </div>

        {invitation.targetRole === "lab" && invitation.lab && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#164E63] mb-2">
              <Building2 size={15} aria-hidden="true" /> تفاصيل المختبر
            </div>
            <div className="rounded-xl bg-[#F8FAFC] border border-gray-100 p-3.5 space-y-2 text-sm">
              {invitation.lab.nameAr && <Row label="المختبر">{invitation.lab.nameAr}</Row>}
              {[invitation.lab.city, invitation.lab.area].filter(Boolean).length > 0 && (
                <Row label="الموقع">{[invitation.lab.city, invitation.lab.area].filter(Boolean).join(" - ")}</Row>
              )}
              {invitation.lab.phone && <Row label="الهاتف"><span dir="ltr">{invitation.lab.phone}</span></Row>}
            </div>
          </div>
        )}

        {emailMismatch ? (
          <div className="mt-5 rounded-xl bg-rose-50 border border-rose-100 p-3.5 flex gap-2 text-sm text-rose-700">
            <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>هذه الدعوة موجّهة إلى بريد مختلف عن الحساب الحالي. سجّل الخروج ثم افتح الرابط من بريد الدعوة.</span>
          </div>
        ) : (
          <>
            <div className="mt-5 space-y-3">
              <PasswordField id="pw" label="كلمة المرور" value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
              <PasswordField id="pw2" label="تأكيد كلمة المرور" value={confirm} onChange={setConfirm} show={showPassword} />
            </div>
            {error && (
              <div className="mt-3 rounded-xl bg-rose-50 border border-rose-100 p-3 flex gap-2 text-sm text-rose-700">
                <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />{error}
              </div>
            )}
            <Button
              variant="primary" size="lg" type="button"
              className="w-full mt-4"
              loading={submitting}
              disabled={submitting || !sessionReady || sessionEmail == null}
              onClick={onSubmit}
            >
              قبول الدعوة
            </Button>
            {sessionReady && sessionEmail == null && (
              <p className="mt-2 text-[11px] text-gray-400 text-center leading-relaxed">
                لإكمال القبول، افتح هذه الصفحة من رابط الدعوة في بريدك الإلكتروني.
              </p>
            )}
          </>
        )}

        <p className="mt-4 text-[11px] text-gray-400 text-center leading-relaxed">
          إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل الرسالة.
        </p>
      </Card>
    </Shell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-400 text-[13px]">{label}</span>
      <span className="font-semibold text-[#164E63] text-end">{children}</span>
    </div>
  );
}

function PasswordField({
  id, label, value, onChange, show, onToggle,
}: { id: string; label: string; value: string; onChange: (v: string) => void; show: boolean; onToggle?: () => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-gray-600 mb-1.5">{label}</label>
      <div className="relative">
        <Lock size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          className="w-full h-12 rounded-xl border border-gray-200 bg-white ps-9 pe-10 text-sm focus:border-[#0891B2] focus:outline-none"
        />
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            className="absolute top-1/2 -translate-y-1/2 end-3 text-gray-400">
            {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={<Shell><Card><div className="h-24 flex items-center justify-center text-sm text-gray-400">جارٍ التحميل…</div></Card></Shell>}>
      <AcceptInner />
    </Suspense>
  );
}
