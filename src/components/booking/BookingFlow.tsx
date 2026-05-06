"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, User, Clock, ChevronLeft, Plus, Calendar as CalendarIcon } from "lucide-react";
import { getShiftConfigs } from "@/lib/mock-data";
import { useSession } from "@/lib/auth";
import { USE_SUPABASE } from "@/lib/supabase/flags";
import { isUuid } from "@/lib/supabase/uuid";
import { usePatients, useAddresses, upsertPatient, upsertAddress, useDefaultPatientId, setDefaultPatient, useProfileStatus } from "@/lib/profile";
import { useToast } from "@/components/ui/Toast";
import { useSystemSettings } from "@/lib/system-settings";
import { useOrders } from "@/lib/store";
import { getShiftLabel, formatDate } from "@/lib/utils";
import type { Test, Package, Shift, Address, Patient } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { BackButton } from "@/components/ui/BackButton";
import { MapPinPicker } from "@/components/booking/MapPinPicker";

interface BookingFlowProps {
  tests?: Test[];
  pkg?: Package;
  onContinue: (data: {
    shift: Shift;
    visitDate: string;
    shiftStartTime: string;
    shiftEndTime: string;
    address: Address;
    patient: Patient;
  }) => void;
  onBack: () => void;
}

// Format a Date as YYYY-MM-DD using LOCAL year/month/day components.
// `toISOString().split("T")[0]` would convert to UTC, which in any
// positive-UTC timezone shifts the date backwards near midnight (e.g.
// Damascus = UTC+3, 22:00 local Sunday → 19:00 UTC Sunday: still Sunday;
// 02:00 local Monday → 23:00 UTC Sunday: ISO returns "Sunday"). That bug
// caused the 3-day picker to render yesterday/today/tomorrow and exposed
// stale weekdays like "Saturday" when the user expected today/tomorrow/
// day-after.
const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function BookingFlow({ tests, pkg, onContinue, onBack }: BookingFlowProps) {
  const session = useSession();
  // Booking is a transactional flow that the customer page already gates on
  // an authenticated customer session; this is the second line of defence
  // against an invalid session sneaking into the inline forms below.
  const userId = session?.role === "customer" ? session.linkedEntityId : null;
  const allAddresses = useAddresses();
  const allPatients = usePatients();
  const defaultPatientId = useDefaultPatientId();
  const profileStatus = useProfileStatus();
  const settings = useSystemSettings();
  const liveOrders = useOrders();

  // Patient defaults to the last one the customer picked. The preference
  // lives in Supabase (customers.default_patient_id) and is loaded by
  // hydrateProfileForCustomer at app startup; we read it through
  // useDefaultPatientId so this component re-renders when the hydrate lands.
  // First-time customers have no default — patient stays null so they make
  // a deliberate choice. We never auto-fill the slot from the account name.
  const [visitDate, setVisitDate] = useState<string>("");
  const [shift, setShift] = useState<Shift | null>(null);
  const [address, setAddress] = useState<Address | null>(allAddresses.find((a) => a.isDefault) ?? allAddresses[0] ?? null);
  const [patient, setPatient] = useState<Patient | null>(() => {
    if (!defaultPatientId) return null;
    return allPatients.find((p) => p.id === defaultPatientId) ?? null;
  });
  // Late-hydration safety net: when the patients list and/or the
  // defaultPatientId arrive from Supabase after first paint, mirror that
  // server state into the local form selection. Only patches when the user
  // hasn't already made a fresh pick.
  useEffect(() => {
    if (patient) return;
    if (!defaultPatientId) return;
    const match = allPatients.find((p) => p.id === defaultPatientId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setPatient(match);
  }, [allPatients, defaultPatientId, patient]);
  const choosePatient = (p: Patient) => {
    setPatient(p);
    if (p.id) void setDefaultPatient(p.id);
  };
  const [whenSheet, setWhenSheet] = useState(false);
  const [addressSheet, setAddressSheet] = useState(false);
  const [patientSheet, setPatientSheet] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [addingPatient, setAddingPatient] = useState(false);
  const toast = useToast();

  // Exactly 3 day cards: today, tomorrow, day after. Each day is a real
  // local Date constructed from year/month/day components — never derived
  // by re-parsing a YYYY-MM-DD string, never via toISOString() or any UTC
  // hop. The weekday and day-of-month displayed in the pills come straight
  // off this Date so they cannot drift relative to the underlying date
  // string handed to getShiftConfigs.
  const candidateDays: {
    date: string;
    weekdayIndex: number;
    dayOfMonth: number;
    shifts: ReturnType<typeof getShiftConfigs>;
    available: boolean;
  }[] = (() => {
    const now = new Date();
    const baseY = now.getFullYear();
    const baseM = now.getMonth();
    const baseD = now.getDate();
    const out: typeof candidateDays = [];
    for (let i = 0; i < 3; i++) {
      // `new Date(y, m, d)` is purely local; passing baseD + i lets the
      // constructor handle month/year rollover correctly.
      const d = new Date(baseY, baseM, baseD + i);
      const date = ymd(d);
      const ordersForDate = liveOrders
        .filter((o) => o.visitDate === date)
        .map((o) => ({ shift: o.shift, status: o.status }));
      const rawShifts = getShiftConfigs({
        date,
        minNoticeMinutes: settings.minBookingNoticeMinutes,
        morningStart: settings.morningShiftStart,
        morningEnd:   settings.morningShiftEnd,
        eveningStart: settings.eveningShiftStart,
        eveningEnd:   settings.eveningShiftEnd,
        ordersForDate,
        maxOrdersPerShift: settings.maxOrdersPerShift,
        bookingWindowDays: settings.bookingWindowDays,
      });
      // Force display order: morning first, evening second. Defensive
      // against any future change to getShiftConfigs return order so the
      // labels and times in the UI never get swapped.
      const morning = rawShifts.find((s) => s.shift === "morning");
      const evening = rawShifts.find((s) => s.shift === "evening");
      const shifts = [morning, evening].filter((s): s is NonNullable<typeof s> => Boolean(s));
      out.push({
        date,
        weekdayIndex: d.getDay(),
        dayOfMonth: d.getDate(),
        shifts,
        available: shifts.some((s) => s.available),
      });
    }
    return out;
  })();

  const canContinue = shift && address && patient && visitDate;

  const submit = () => {
    if (!canContinue) return;
    const day = candidateDays.find((d) => d.date === visitDate);
    const sCfg = day?.shifts.find((x) => x.shift === shift);
    // Logic guard: even if the UI was bypassed, refuse a date/shift that
    // getShiftConfigs() considers unavailable (out-of-window, past, or
    // inside the min-notice cushion).
    if (!sCfg?.available) {
      toast.error("هذا الموعد غير متاح، يرجى اختيار وقت آخر");
      return;
    }
    // Stage E race-fix: refuse to forward a placeholder UUID that would
    // later make /api/orders reject the create with an FK error. Customer
    // must wait for upsertPatient/upsertAddress to round-trip first.
    if (USE_SUPABASE) {
      if (!isUuid(patient!.id) || !isUuid(address!.id)) {
        toast.error("جاري حفظ بياناتك… حاول مرة أخرى بعد لحظة");
        return;
      }
    }
    const startH = String(sCfg.startHour).padStart(2, "0");
    const endH = String(sCfg.endHour).padStart(2, "0");
    onContinue({
      shift: shift!,
      visitDate,
      shiftStartTime: `${startH}:00`,
      shiftEndTime: `${endH}:00`,
      address: address!,
      patient: patient!,
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/40">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-100">
        <BackButton onClick={onBack} />
        <h1 className="text-[16px] font-bold text-[#164E63]">تفاصيل الزيارة</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-cta space-y-3">
        {/* Summary chip */}
        <div className="bg-[#ECFEFF] rounded-xl px-4 py-3 flex items-center gap-2">
          <Clock size={14} className="text-[#0891B2] flex-shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium text-[#164E63]">
            {pkg ? pkg.nameAr : `${tests?.length ?? 0} تحليل مختار`}
          </p>
        </div>

        {/* Day + slot — single step */}
        <SectionRow
          icon={<CalendarIcon size={18} className="text-[#0891B2]" />}
          title="موعد الزيارة"
          value={(() => {
            if (!visitDate || !shift) return null;
            // Use the weekday we already computed for this date in
            // candidateDays — re-parsing the YYYY-MM-DD string here would
            // re-introduce the very TZ ambiguity we just removed.
            const day = candidateDays.find((d) => d.date === visitDate);
            const weekday = day ? WEEKDAYS_AR[day.weekdayIndex] : "";
            return `${weekday} · ${formatDate(visitDate)} — ${getShiftLabel(shift)}`;
          })()}
          placeholder="اختر اليوم والفترة"
          required
          onClick={() => setWhenSheet(true)}
        />

        {/* Address */}
        <SectionRow
          icon={<MapPin size={18} className="text-[#059669]" />}
          title="عنوان الزيارة"
          value={address ? `${address.label} – ${address.description}` : null}
          placeholder="اختر أو أضف عنواناً"
          required
          onClick={() => setAddressSheet(true)}
        />

        {/* Patient — explicit selection. We never auto-fill the patient slot
           from the account name; the patient is a distinct entity (it may
           be a relative). The picker copy spells that out. */}
        <SectionRow
          icon={<User size={18} className="text-purple-600" />}
          title="اسم المريض"
          value={patient?.name ?? null}
          placeholder="اختر أو أضف المريض"
          required
          onClick={() => setPatientSheet(true)}
        />

        <p className="text-xs text-gray-400 px-1 leading-relaxed">
          المريض هو الشخص الذي ستؤخذ منه العينة، وقد يكون شخصاً آخر غير صاحب الحساب. سيتحقق الممرض من هويته عند الوصول.
        </p>
      </div>

      {/* CTA — fixed on mobile so it stays visible while the form scrolls.
         The scroll container above adds `pb-cta` so content isn't hidden. */}
      <div className="fixed md:static bottom-0 inset-x-0 px-4 pt-3 bg-white border-t border-gray-100 safe-bottom-md z-30">
        <div className="max-w-md mx-auto">
          <Button
            onClick={submit}
            size="lg"
            className="w-full"
            disabled={!canContinue}
            aria-disabled={!canContinue}
          >
            مراجعة السلة
          </Button>
        </div>
      </div>

      {/* Combined day + slot picker — single step */}
      <BottomSheet open={whenSheet} onClose={() => setWhenSheet(false)} title="اختر اليوم والفترة">
        <div className="px-4 py-4">
          <WhenPicker
            days={candidateDays}
            selectedDate={visitDate}
            selectedShift={shift}
            onPick={(date, picked) => {
              setVisitDate(date);
              setShift(picked);
              setWhenSheet(false);
            }}
          />
        </div>
      </BottomSheet>

      {/* Address Sheet */}
      <BottomSheet open={addressSheet} onClose={() => setAddressSheet(false)} title="العنوان">
        <div className="px-4 py-4 space-y-2">
          {profileStatus === "loading" && allAddresses.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">جاري تحميل عناوينك…</p>
          )}
          {profileStatus === "ready" && allAddresses.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">لا توجد عناوين محفوظة. أضف عنواناً جديداً للبدء.</p>
          )}
          {allAddresses.map((addr) => (
            <motion.button
              key={addr.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => { setAddress(addr); setAddressSheet(false); }}
              aria-pressed={address?.id === addr.id}
              className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all duration-150 text-start ${address?.id === addr.id ? "border-[#0891B2] bg-[#ECFEFF]" : "border-gray-200 bg-white active:bg-gray-50"}`}
            >
              <MapPin size={16} className="text-[#059669] mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#164E63]">{addr.label}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{addr.description}</p>
              </div>
            </motion.button>
          ))}
          <button
            onClick={() => { setAddingAddress(true); setAddressSheet(false); }}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer active:bg-gray-50"
          >
            <Plus size={16} className="text-[#0891B2]" aria-hidden="true" />
            <span className="text-sm font-medium text-[#0891B2]">إضافة عنوان جديد</span>
          </button>
        </div>
      </BottomSheet>

      {/* Patient Sheet */}
      <BottomSheet open={patientSheet} onClose={() => setPatientSheet(false)} title="اختر المريض">
        <div className="px-4 py-4 space-y-2">
          <p className="text-[11px] text-gray-500 leading-relaxed mb-1">
            المريض شخص مستقل عن صاحب الحساب. اختر من القائمة أو أضف مريضاً جديداً.
          </p>
          {profileStatus === "loading" && allPatients.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">جاري تحميل قائمة المرضى…</p>
          )}
          {profileStatus === "ready" && allPatients.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">لم تُسجّل مريضاً بعد. أضف مريضاً جديداً للمتابعة.</p>
          )}
          {allPatients.map((p) => (
            <motion.button
              key={p.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => { choosePatient(p); setPatientSheet(false); }}
              aria-pressed={patient?.id === p.id}
              className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all duration-150 text-start ${patient?.id === p.id ? "border-[#0891B2] bg-[#ECFEFF]" : "border-gray-200 bg-white active:bg-gray-50"}`}
            >
              <div className="w-10 h-10 bg-[#0891B2]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <User size={17} className="text-[#0891B2]" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#164E63]">{p.name}</p>
                {p.isDefault && <span className="text-xs text-[#059669] font-medium">افتراضي</span>}
              </div>
            </motion.button>
          ))}
          <button
            onClick={() => { setAddingPatient(true); setPatientSheet(false); }}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer active:bg-gray-50"
          >
            <Plus size={16} className="text-[#0891B2]" aria-hidden="true" />
            <span className="text-sm font-medium text-[#0891B2]">إضافة مريض جديد</span>
          </button>
        </div>
      </BottomSheet>

      {/* Inline add-address */}
      <BottomSheet open={addingAddress} onClose={() => setAddingAddress(false)} title="إضافة عنوان">
        <AddressInlineForm
          userId={userId}
          onCancel={() => setAddingAddress(false)}
          onSubmit={async (a) => {
            if (!userId) { toast.error("يجب تسجيل الدخول قبل حفظ العنوان"); return; }
            const r = await upsertAddress({ ...a, userId });
            if (!r.ok) { toast.error(r.error ?? "تعذر حفظ العنوان"); return; }
            setAddress(r.address ?? a);
            setAddingAddress(false);
            toast.success("تم الحفظ بنجاح");
          }}
        />
      </BottomSheet>

      {/* Inline add-patient */}
      <BottomSheet open={addingPatient} onClose={() => setAddingPatient(false)} title="إضافة مريض">
        <PatientInlineForm
          userId={userId}
          onCancel={() => setAddingPatient(false)}
          onSubmit={async (p) => {
            if (!userId) { toast.error("يجب تسجيل الدخول قبل حفظ المريض"); return; }
            const r = await upsertPatient({ ...p, userId });
            if (!r.ok) { toast.error(r.error ?? "تعذر حفظ المريض"); return; }
            choosePatient(r.patient ?? p);
            setAddingPatient(false);
            toast.success("تم الحفظ بنجاح");
          }}
        />
      </BottomSheet>
    </div>
  );
}

function AddressInlineForm({ userId, onCancel, onSubmit }: { userId: string | null; onCancel: () => void; onSubmit: (a: Address) => void }) {
  // Per spec the form asks only for: map pin, optional description, city.
  // No label / default toggle — both were noise. We default `label` to the
  // city under the hood so back-end constraints (label NOT NULL) still pass.
  const [description, setDescription] = useState("");
  const [city, setCity] = useState<string>("دمشق");
  const [lat, setLat] = useState<number>(33.5138);
  const [lng, setLng] = useState<number>(36.2765);
  const [pinPlaced, setPinPlaced] = useState(false);
  return (
    <div className="px-4 pb-4 space-y-3">
      <Field label="حدد الموقع على الخريطة">
        <MapPinPicker
          lat={lat}
          lng={lng}
          placed={pinPlaced}
          onChange={(nLat, nLng) => {
            setLat(nLat);
            setLng(nLng);
            setPinPlaced(true);
          }}
        />
      </Field>
      <Field label="تفاصيل إضافية (اختياري)">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="رقم البناء، الطابق، نقطة دالة" className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none" />
      </Field>
      <Field label="المدينة / المنطقة">
        <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="دمشق">دمشق</option>
          <option value="ريف دمشق">ريف دمشق</option>
        </select>
      </Field>
      {!pinPlaced && (
        <p className="text-[11px] text-amber-600">يرجى تحديد الموقع على الخريطة قبل الحفظ.</p>
      )}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
        <Button
          variant="primary" className="flex-1"
          disabled={!pinPlaced}
          onClick={() => onSubmit({
            id: `addr-${Date.now()}`,
            userId: userId ?? "",
            label: city,                 // back-compat: label stays NOT NULL
            description: description.trim(),
            lat, lng,
            city,
            isDefault: false,
          })}
        >حفظ</Button>
      </div>
    </div>
  );
}

function PatientInlineForm({ userId, onCancel, onSubmit }: { userId: string | null; onCancel: () => void; onSubmit: (p: Patient) => void }) {
  const [name, setName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="px-4 pb-4 space-y-3">
      <p className="text-[11px] text-gray-500 leading-relaxed">
        أدخل اسم المريض كما هو مدوّن في وثائقه الرسمية. لا تستخدم اسم صاحب الحساب إن لم يكن هو المريض.
      </p>
      <Field label="اسم المريض الكامل">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أحمد محمد علي" className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
      </Field>
      <Field label="الرقم الوطني (اختياري)">
        <input value={nationalId} onChange={(e) => setNationalId(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
      </Field>
      <Field label="ملاحظة (اختياري)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="صلة القرابة، تنبيهات صحية" className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
      </Field>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
        <Button
          variant="primary" className="flex-1"
          disabled={!name.trim()}
          onClick={() => onSubmit({
            id: `p-${Date.now()}`,
            userId: userId ?? "",
            name: name.trim(),
            nationalId: nationalId.trim() || undefined,
            note: note.trim() || undefined,
            isDefault: false,
          })}
        >حفظ</Button>
      </div>
    </div>
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

function SectionRow({ icon, title, value, placeholder, required, onClick }: {
  icon: React.ReactNode;
  title: string;
  value: string | null;
  placeholder: string;
  required?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      aria-required={required}
      className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 cursor-pointer text-start transition-colors active:bg-gray-50"
    >
      <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-0.5">{title}{required && !value && <span className="text-red-400 me-0.5">*</span>}</p>
        <p className={`text-sm font-semibold truncate ${value ? "text-[#164E63]" : "text-gray-300"}`}>
          {value ?? placeholder}
        </p>
      </div>
      <ChevronLeft size={15} className="text-gray-300 flex-shrink-0" aria-hidden="true" />
    </motion.button>
  );
}

// ─── Combined day + slot picker (single step) ───────────────────────────────
// Two-row layout: a row of three day pills (today / tomorrow / day-after)
// is always rendered — disabled days stay visible but un-selectable. Below
// the pills, the time-slot grid for the *selected* day appears in the same
// sheet, so the user never leaves this screen to pick a time. Tapping an
// available slot commits both selections and closes the sheet.
function WhenPicker({
  days,
  selectedDate,
  selectedShift,
  onPick,
}: {
  // weekdayIndex / dayOfMonth come from the same Date that produced the
  // YYYY-MM-DD string — no re-parsing here, so TZ can never drift.
  days: {
    date: string;
    weekdayIndex: number;
    dayOfMonth: number;
    shifts: { shift: Shift; labelAr: string; startHour: number; endHour: number; available: boolean; unavailableReason?: string }[];
    available: boolean;
  }[];
  selectedDate: string;
  selectedShift: Shift | null;
  onPick: (date: string, shift: Shift) => void;
}) {
  const offsetTagFor = (i: number, weekdayIndex: number): string => {
    if (i === 0) return "اليوم";
    if (i === 1) return "غداً";
    if (i === 2) return "بعد غد";
    return WEEKDAYS_AR[weekdayIndex];
  };

  // Local "active" day: whichever day's slot grid is shown beneath the pills.
  // Falls back to the prior selection, then to the first available day, then
  // to the first day overall (so the empty state always has context).
  const fallback = selectedDate || days.find((d) => d.available)?.date || days[0]?.date || "";
  const [activeDate, setActiveDate] = useState<string>(fallback);
  const activeDay = days.find((d) => d.date === activeDate) ?? days[0];

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#164E63] font-medium">اختر اليوم ثم الوقت في نفس الشاشة.</p>

      {/* Three day pills — always exactly today / tomorrow / day-after. */}
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="اختيار اليوم">
        {days.map((day, i) => {
          const isActive = day.date === activeDate;
          const isDisabled = !day.available;
          return (
            <button
              key={day.date}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={isDisabled}
              disabled={isDisabled}
              onClick={() => { if (!isDisabled) setActiveDate(day.date); }}
              className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl border-2 transition-all ${
                isActive
                  ? "border-[#0891B2] bg-[#ECFEFF] cursor-pointer"
                  : isDisabled
                    ? "border-gray-100 bg-gray-50/70 opacity-60 cursor-not-allowed"
                    : "border-gray-200 bg-white active:bg-gray-50 cursor-pointer"
              }`}
            >
              <span className={`text-[10px] font-semibold tracking-wide ${
                isActive ? "text-[#0891B2]" : isDisabled ? "text-gray-400" : "text-gray-500"
              }`}>
                {offsetTagFor(i, day.weekdayIndex)}
              </span>
              <span className={`text-lg font-bold lat mt-0.5 ${
                isActive ? "text-[#0891B2]" : isDisabled ? "text-gray-400" : "text-[#164E63]"
              }`} dir="ltr">{day.dayOfMonth}</span>
              <span className={`text-[10px] mt-0.5 ${
                isDisabled ? "text-amber-600" : "text-gray-400"
              }`}>
                {isDisabled ? "غير متاح" : WEEKDAYS_AR[day.weekdayIndex]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Slot grid for the active day. Stays in this same sheet — no
         second-step navigation. */}
      <div>
        <p className="text-[11px] font-semibold text-gray-500 mb-2 px-0.5">
          {activeDay && !activeDay.available
            ? "لا توجد مواعيد متاحة في هذا اليوم"
            : "اختر الوقت"}
        </p>
        {activeDay && activeDay.available ? (
          <div className="grid grid-cols-2 gap-2">
            {activeDay.shifts.map((s) => {
              const isSelected = selectedDate === activeDay.date && selectedShift === s.shift;
              const slotDisabled = !s.available;
              return (
                <motion.button
                  key={s.shift}
                  whileTap={{ scale: slotDisabled ? 1 : 0.97 }}
                  onClick={() => { if (!slotDisabled) onPick(activeDay.date, s.shift); }}
                  disabled={slotDisabled}
                  aria-pressed={isSelected}
                  aria-disabled={slotDisabled}
                  className={`flex flex-col items-start gap-1 p-3 rounded-xl border-2 transition-all text-start ${
                    isSelected
                      ? "border-[#0891B2] bg-[#ECFEFF] cursor-pointer"
                      : slotDisabled
                        ? "border-gray-100 bg-gray-50/80 opacity-60 cursor-not-allowed"
                        : "border-gray-200 bg-white active:bg-gray-50 cursor-pointer"
                  }`}
                >
                  <span className={`text-sm font-bold ${isSelected ? "text-[#0891B2]" : slotDisabled ? "text-gray-400" : "text-[#164E63]"}`}>
                    {s.labelAr}
                  </span>
                  <span className="text-[11px] text-gray-500 lat" dir="ltr">
                    {String(s.startHour).padStart(2, "0")}:00 – {String(s.endHour).padStart(2, "0")}:00
                  </span>
                  {slotDisabled && s.unavailableReason && (
                    <span className="text-[10px] text-amber-600 leading-tight">{s.unavailableReason}</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-3">
            <p className="text-[12px] text-amber-700 leading-relaxed">
              اختر يوماً متاحاً من الأعلى لعرض المواعيد.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
