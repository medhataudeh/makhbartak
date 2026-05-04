"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, MapPin, CreditCard, LifeBuoy, FileText, Shield, LogOut,
  ChevronLeft, Phone, Plus, Banknote, Pencil, Trash2,
} from "lucide-react";
import type { ContentPageSlug, Patient, Address } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { usePreferredPayment, setPreferredPayment } from "@/lib/payment-pref";
import {
  usePatients, upsertPatient, deletePatient,
  useAddresses, upsertAddress, deleteAddress,
} from "@/lib/profile";
import { SEED_CUSTOMER_1_ID } from "@/lib/mock-data";
import { Button } from "@/components/ui/Button";
import { BackButton } from "@/components/ui/BackButton";
import { CmsPage } from "@/components/account/CmsPage";

type SubPage = "profile" | "addresses" | "patients" | "payment" | "support" | "terms" | "privacy";

interface AccountScreenProps {
  onLogout: () => void;
  /** Soft-delete current account: clear local state + show success toast. */
  onDeleteAccount?: () => void;
}

export function AccountScreen({ onLogout, onDeleteAccount }: AccountScreenProps) {
  const [page, setPage] = useState<SubPage | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const patients = usePatients();
  const headlineName = patients.find((p) => p.isDefault)?.name ?? patients[0]?.name ?? "—";

  return (
    <div className="flex flex-col pb-nav bg-gray-50/40 min-h-screen">
      <div className="px-4 pt-5 pb-4 bg-white border-b border-gray-100">
        <h1 className="text-xl font-bold text-[#164E63]">حسابي</h1>
      </div>

      {/* Profile card */}
      <div className="px-4 py-4">
        <div className="bg-[#0891B2] rounded-2xl p-5 text-white">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <User size={26} className="text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-bold truncate">{headlineName}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Phone size={12} className="text-cyan-200 flex-shrink-0" aria-hidden="true" />
                <p className="text-sm text-cyan-200 lat" dir="ltr">+963 911 000 000</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hub menu */}
      <div className="px-4 space-y-3">
        <Group>
          <HubItem icon={<User size={16} className="text-[#0891B2]" />}     label="بياناتي"            onClick={() => setPage("profile")} />
          <HubItem icon={<MapPin size={16} className="text-[#059669]" />}    label="عناويني"            onClick={() => setPage("addresses")} />
          <HubItem icon={<User size={16} className="text-purple-600" />}     label="المرضى"             onClick={() => setPage("patients")} />
          <HubItem icon={<CreditCard size={16} className="text-[#0891B2]" />} label="طريقة الدفع المحفوظة" onClick={() => setPage("payment")} />
        </Group>
        <Group>
          <HubItem icon={<LifeBuoy size={16} className="text-amber-600" />}  label="الدعم"             onClick={() => setPage("support")} />
          <HubItem icon={<FileText size={16} className="text-gray-500" />}   label="الشروط والأحكام"    onClick={() => setPage("terms")} />
          <HubItem icon={<Shield size={16} className="text-gray-500" />}     label="سياسة الخصوصية"     onClick={() => setPage("privacy")} />
        </Group>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-red-50 border border-red-100 cursor-pointer active:bg-red-100 transition-colors"
          aria-label="تسجيل الخروج"
        >
          <LogOut size={17} className="text-red-500" aria-hidden="true" />
          <span className="text-sm font-semibold text-red-500">تسجيل الخروج</span>
        </motion.button>

        {onDeleteAccount && (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="w-full text-center py-3 text-xs text-gray-400 cursor-pointer underline-offset-4 hover:underline"
          >
            حذف الحساب
          </button>
        )}
      </div>

      {confirmingDelete && onDeleteAccount && (
        <DeleteAccountConfirm
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => { setConfirmingDelete(false); onDeleteAccount(); }}
        />
      )}

      <AnimatePresence>
        {page && <SubPageHost page={page} onBack={() => setPage(null)} />}
      </AnimatePresence>
    </div>
  );
}

function SubPageHost({ page, onBack }: { page: SubPage; onBack: () => void }) {
  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-40 bg-app flex flex-col"
      style={{ maxWidth: "448px", margin: "0 auto" }}
    >
      {page === "profile"   && <ProfilePage onBack={onBack} />}
      {page === "addresses" && <AddressesPage onBack={onBack} />}
      {page === "patients"  && <PatientsPage onBack={onBack} />}
      {page === "payment"   && <PaymentPage onBack={onBack} />}
      {(page === "support" || page === "terms" || page === "privacy") && (
        <CmsPage slug={page === "terms" ? "terms" : page === "privacy" ? "privacy" : "support"} onBack={onBack} />
      )}
    </motion.div>
  );
}

// ─── Sub-pages ───────────────────────────────────────────────────────────────
function ProfilePage({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const patients = usePatients();
  const me = patients.find((p) => p.isDefault) ?? patients[0];
  const [name, setName] = useState(me?.name ?? "");
  const [phone] = useState("+963 911 000 000");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast.error("الاسم مطلوب"); return; }
    if (!me) { toast.error("لا يوجد ملف مريض"); return; }
    setSaving(true);
    const r = await upsertPatient({ ...me, name: name.trim() });
    setSaving(false);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    toast.success("تم الحفظ بنجاح");
    onBack();
  };

  return (
    <SubPageShell title="بياناتي" onBack={onBack}>
      <Field label="الاسم">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none" />
      </Field>
      <Field label="الهاتف">
        <input value={phone} disabled className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm text-gray-400 bg-gray-50 lat" dir="ltr" />
        <p className="text-[11px] text-gray-400 mt-1">رقم الهاتف غير قابل للتعديل بعد التسجيل.</p>
      </Field>
      <Button variant="primary" size="lg" className="w-full mt-4" onClick={save} loading={saving}>
        حفظ التعديلات
      </Button>
    </SubPageShell>
  );
}

function AddressesPage({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const addresses = useAddresses();
  const [editing, setEditing] = useState<Address | null>(null);
  const [creating, setCreating] = useState(false);

  const upsert = async (a: Address) => {
    const r = await upsertAddress(a);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };
  const remove = async (id: string) => {
    const r = await deleteAddress(id);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
    toast.success("تم الحذف");
  };

  return (
    <SubPageShell title="عناويني" onBack={onBack}>
      <ul className="space-y-2">
        {addresses.map((addr) => (
          <li key={addr.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-start gap-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <MapPin size={15} className="text-[#059669]" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#164E63]">{addr.label}</p>
              <p className="text-xs text-gray-400 leading-relaxed mt-0.5">{addr.description}</p>
              {addr.isDefault && <span className="text-[11px] text-[#059669] font-medium">افتراضي</span>}
            </div>
            <button onClick={() => setEditing(addr)} aria-label="تعديل" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer">
              <Pencil size={13} className="text-gray-500" aria-hidden="true" />
            </button>
            <button onClick={() => remove(addr.id)} aria-label="حذف" className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center cursor-pointer">
              <Trash2 size={13} className="text-red-400" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setCreating(true)}
        className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-[#0891B2] text-sm font-semibold cursor-pointer active:bg-gray-50"
      >
        <Plus size={15} aria-hidden="true" /> إضافة عنوان جديد
      </button>

      {(editing || creating) && (
        <AddressForm
          initial={editing ?? undefined}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={upsert}
        />
      )}
    </SubPageShell>
  );
}

function AddressForm({ initial, onCancel, onSubmit }: {
  initial?: Address; onCancel: () => void; onSubmit: (a: Address) => void;
}) {
  const [d, setD] = useState<Address>(() => initial ?? {
    id: `addr-${Date.now()}`, userId: SEED_CUSTOMER_1_ID, label: "", description: "",
    lat: 33.5138, lng: 36.2765, city: "دمشق", isDefault: false,
  });
  const set = <K extends keyof Address>(k: K, v: Address[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-[#164E63]">{initial ? "تعديل العنوان" : "إضافة عنوان"}</h3>
        <Field label="التسمية">
          <input value={d.label} onChange={(e) => set("label", e.target.value)} placeholder="المنزل / العمل" className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
        </Field>
        <Field label="العنوان">
          <textarea value={d.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none" />
        </Field>
        <Field label="المدينة">
          <select value={d.city} onChange={(e) => set("city", e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
            <option value="دمشق">دمشق</option>
            <option value="ريف دمشق">ريف دمشق</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-[#164E63]">
          <input type="checkbox" checked={d.isDefault} onChange={(e) => set("isDefault", e.target.checked)} className="w-4 h-4" />
          العنوان الافتراضي
        </label>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" className="flex-1" disabled={!d.label.trim() || !d.description.trim()} onClick={() => onSubmit(d)}>حفظ</Button>
        </div>
      </div>
    </div>
  );
}

function PatientsPage({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const patients = usePatients();
  const [editing, setEditing] = useState<Patient | null>(null);
  const [creating, setCreating] = useState(false);

  const upsert = async (p: Patient) => {
    const r = await upsertPatient(p);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };
  const remove = async (id: string) => {
    const r = await deletePatient(id);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحذف"); return; }
    toast.success("تم الحذف");
  };

  return (
    <SubPageShell title="المرضى" onBack={onBack}>
      <ul className="space-y-2">
        {patients.map((p) => (
          <li key={p.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <User size={15} className="text-purple-600" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#164E63]">{p.name}</p>
              {p.isDefault && <span className="text-[11px] text-[#059669] font-medium">افتراضي</span>}
            </div>
            <button onClick={() => setEditing(p)} aria-label="تعديل" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer">
              <Pencil size={13} className="text-gray-500" aria-hidden="true" />
            </button>
            <button onClick={() => remove(p.id)} aria-label="حذف" className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center cursor-pointer">
              <Trash2 size={13} className="text-red-400" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setCreating(true)}
        className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-[#0891B2] text-sm font-semibold cursor-pointer active:bg-gray-50"
      >
        <Plus size={15} aria-hidden="true" /> إضافة مريض جديد
      </button>

      {(editing || creating) && (
        <PatientForm
          initial={editing ?? undefined}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={upsert}
        />
      )}
    </SubPageShell>
  );
}

function PatientForm({ initial, onCancel, onSubmit }: {
  initial?: Patient; onCancel: () => void; onSubmit: (p: Patient) => void;
}) {
  const [d, setD] = useState<Patient>(() => initial ?? {
    id: `p-${Date.now()}`, userId: SEED_CUSTOMER_1_ID, name: "", isDefault: false,
  });
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-[#164E63]">{initial ? "تعديل المريض" : "إضافة مريض"}</h3>
        <Field label="اسم المريض">
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
        </Field>
        <Field label="الرقم الوطني (اختياري)">
          <input value={d.nationalId ?? ""} onChange={(e) => setD({ ...d, nationalId: e.target.value || undefined })} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
        </Field>
        <Field label="ملاحظة">
          <textarea value={d.note ?? ""} onChange={(e) => setD({ ...d, note: e.target.value || undefined })} rows={2} className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-[#164E63]">
          <input type="checkbox" checked={d.isDefault} onChange={(e) => setD({ ...d, isDefault: e.target.checked })} className="w-4 h-4" />
          المريض الافتراضي
        </label>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" className="flex-1" disabled={!d.name.trim()} onClick={() => onSubmit(d)}>حفظ</Button>
        </div>
      </div>
    </div>
  );
}

function PaymentPage({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const saved = usePreferredPayment();
  const [pick, setPick] = useState<"cash" | "online">(saved ?? "cash");

  const save = async () => {
    const r = await setPreferredPayment(pick);
    if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
    toast.success("تم الحفظ بنجاح");
    onBack();
  };

  return (
    <SubPageShell title="طريقة الدفع المحفوظة" onBack={onBack}>
      <p className="text-xs text-gray-500 leading-relaxed mb-3">
        تُستخدم طريقة الدفع المحفوظة افتراضياً عند تأكيد الطلبات، ويمكن تغييرها وقت الحاجة من السلة.
      </p>
      <div className="space-y-2">
        {([
          { v: "cash"   as const, Icon: Banknote,    color: "text-[#059669]", label: "الدفع عند الاستلام", sub: "نقداً عند وصول الممرض" },
          { v: "online" as const, Icon: CreditCard,  color: "text-[#0891B2]", label: "الدفع الإلكتروني",   sub: "بطاقة فيزا / ماستركارد" },
        ]).map((opt) => {
          const active = pick === opt.v;
          return (
            <motion.button
              key={opt.v}
              whileTap={{ scale: 0.97 }}
              onClick={() => setPick(opt.v)}
              aria-pressed={active}
              className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer text-start ${active ? "border-[#0891B2] bg-[#ECFEFF]" : "border-gray-200 bg-white"}`}
            >
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <opt.Icon size={18} className={opt.color} aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#164E63]">{opt.label}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{opt.sub}</p>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${active ? "border-[#0891B2] bg-[#0891B2]" : "border-gray-300"}`}>
                {active && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
            </motion.button>
          );
        })}
      </div>
      <Button variant="primary" size="lg" className="w-full mt-4" onClick={save}>
        حفظ الاختيار
      </Button>
    </SubPageShell>
  );
}

// ─── Local helpers ───────────────────────────────────────────────────────────
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
      {children}
    </div>
  );
}

function HubItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 cursor-pointer text-start active:bg-gray-50 transition-colors"
    >
      <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0">{icon}</div>
      <span className="flex-1 text-sm font-medium text-[#164E63]">{label}</span>
      <ChevronLeft size={15} className="text-gray-300" aria-hidden="true" />
    </button>
  );
}

function SubPageShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 pb-4 bg-white border-b border-gray-100 safe-top-md">
        <BackButton onClick={onBack} />
        <h2 className="text-[15px] font-bold text-[#164E63] flex-1">{title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {children}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function DeleteAccountConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const [reason, setReason] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"reason" | "otp">("reason");
  const [error, setError] = useState("");
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] bg-black/55 flex items-end md:items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden">
        <header className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-[#164E63]">حذف الحساب</h3>
          <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
            سيتم إخفاء حسابك وبياناتك على هذا الجهاز. يمكنك العودة في أي وقت بإنشاء حساب جديد.
          </p>
        </header>
        <div className="p-5 space-y-3">
          {step === "reason" ? (
            <>
              <label className="block text-[11px] font-medium text-gray-500">
                السبب (اختياري)
                <textarea
                  value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                  className="w-full mt-1 p-3 rounded-xl border border-gray-200 text-sm resize-none focus:border-[#0891B2] outline-none"
                />
              </label>
              <div className="flex gap-2">
                <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#164E63] cursor-pointer">إلغاء</button>
                <button onClick={() => { setError(""); setStep("otp"); }} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold cursor-pointer">متابعة</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500 leading-relaxed">
                للتأكيد أدخل رمز التحقق المُرسل إلى رقم هاتفك. استخدم{" "}
                <span className="lat font-bold text-[#0891B2]" dir="ltr">1234</span> في النسخة التجريبية.
              </p>
              <input
                type="text" inputMode="numeric" maxLength={4}
                value={otp} onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
                className="w-full h-12 px-3 text-center text-xl rounded-xl border-2 border-gray-200 focus:border-red-300 outline-none lat"
                dir="ltr"
                aria-label="رمز التحقق"
              />
              {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-[#164E63] cursor-pointer">إلغاء</button>
                <button
                  onClick={() => {
                    if (otp !== "1234") { setError("الرمز غير صحيح"); return; }
                    onConfirm();
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                  disabled={otp.length < 4}
                >
                  حذف الحساب
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// re-export the slug type for any external user
export type { ContentPageSlug };
