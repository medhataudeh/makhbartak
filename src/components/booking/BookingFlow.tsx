"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { MapPin, User, Clock, ChevronLeft, Plus, Calendar as CalendarIcon } from "lucide-react";
import { getShiftConfigs, SEED_CUSTOMER_1_ID } from "@/lib/mock-data";
import { USE_SUPABASE } from "@/lib/supabase/flags";
import { isUuid } from "@/lib/supabase/uuid";
import { usePatients, useAddresses, upsertPatient, upsertAddress } from "@/lib/profile";
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

const ymd = (d: Date) => d.toISOString().split("T")[0];
const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function BookingFlow({ tests, pkg, onContinue, onBack }: BookingFlowProps) {
  const allAddresses = useAddresses();
  const allPatients = usePatients();
  const settings = useSystemSettings();
  const liveOrders = useOrders();

  // Patient/date stays unselected until the user explicitly chooses one — we
  // never auto-fill the patient slot from the account name (those are two
  // distinct entities; see PatientInlineForm copy).
  const [visitDate, setVisitDate] = useState<string>("");
  const [shift, setShift] = useState<Shift | null>(null);
  const [address, setAddress] = useState<Address | null>(allAddresses.find((a) => a.isDefault) ?? allAddresses[0] ?? null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [whenSheet, setWhenSheet] = useState(false);
  const [addressSheet, setAddressSheet] = useState(false);
  const [patientSheet, setPatientSheet] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [addingPatient, setAddingPatient] = useState(false);
  const toast = useToast();

  // Always render exactly 3 day cards (today + next 2). Days that have zero
  // available shifts stay visible but the cell is disabled so the customer
  // can see what's full and pick something else. Logic-side guards still
  // refuse a disabled date in submit().
  const candidateDays: { date: string; shifts: ReturnType<typeof getShiftConfigs>; available: boolean }[] = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: typeof candidateDays = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const date = ymd(d);
      const ordersForDate = liveOrders
        .filter((o) => o.visitDate === date)
        .map((o) => ({ shift: o.shift, status: o.status }));
      const shifts = getShiftConfigs({
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
      out.push({ date, shifts, available: shifts.some((s) => s.available) });
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

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-28">
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
          value={
            visitDate && shift
              ? `${WEEKDAYS_AR[new Date(visitDate + "T00:00:00").getDay()]} · ${formatDate(visitDate)} — ${getShiftLabel(shift)}`
              : null
          }
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

      {/* CTA */}
      <div className="px-4 py-3 bg-white border-t border-gray-100 safe-bottom">
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
          {allPatients.map((p) => (
            <motion.button
              key={p.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => { setPatient(p); setPatientSheet(false); }}
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
          onCancel={() => setAddingAddress(false)}
          onSubmit={async (a) => {
            const r = await upsertAddress(a);
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
          onCancel={() => setAddingPatient(false)}
          onSubmit={async (p) => {
            const r = await upsertPatient(p);
            if (!r.ok) { toast.error(r.error ?? "تعذر حفظ المريض"); return; }
            setPatient(r.patient ?? p);
            setAddingPatient(false);
            toast.success("تم الحفظ بنجاح");
          }}
        />
      </BottomSheet>
    </div>
  );
}

function AddressInlineForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (a: Address) => void }) {
  const [label, setLabel] = useState("المنزل");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState<string>("دمشق");
  const [makeDefault, setMakeDefault] = useState(false);
  // Coordinates start at the city center; the map records that the user
  // actively placed a pin so we don't accept an unmoved default as "located".
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
      <Field label="التسمية">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="المنزل / العمل" className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
      </Field>
      <Field label="تفاصيل العنوان (الحي، الشارع، رقم البناء، الطابق)">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="مثال: المزة – شارع الفردوس، بناء 12، الطابق 3" className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none" />
      </Field>
      <Field label="المدينة / المنطقة">
        <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="دمشق">دمشق</option>
          <option value="ريف دمشق">ريف دمشق</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-[#164E63]">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="w-4 h-4" />
        اجعله العنوان الافتراضي
      </label>
      {!pinPlaced && (
        <p className="text-[11px] text-amber-600">يرجى تحديد الموقع على الخريطة قبل الحفظ.</p>
      )}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
        <Button
          variant="primary" className="flex-1"
          disabled={!label.trim() || !description.trim() || !pinPlaced}
          onClick={() => onSubmit({
            id: `addr-${Date.now()}`,
            userId: SEED_CUSTOMER_1_ID,
            label: label.trim(),
            description: description.trim(),
            lat, lng,
            city, isDefault: makeDefault,
          })}
        >حفظ</Button>
      </div>
    </div>
  );
}

function PatientInlineForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (p: Patient) => void }) {
  const [name, setName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
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
      <label className="flex items-center gap-2 text-sm text-[#164E63]">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="w-4 h-4" />
        اجعله المريض الافتراضي
      </label>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
        <Button
          variant="primary" className="flex-1"
          disabled={!name.trim()}
          onClick={() => onSubmit({
            id: `p-${Date.now()}`,
            userId: SEED_CUSTOMER_1_ID,
            name: name.trim(),
            nationalId: nationalId.trim() || undefined,
            isDefault: makeDefault,
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
        <p className="text-xs text-gray-400 mb-0.5">{title}{required && !value && <span className="text-red-400 mr-0.5">*</span>}</p>
        <p className={`text-sm font-semibold truncate ${value ? "text-[#164E63]" : "text-gray-300"}`}>
          {value ?? placeholder}
        </p>
      </div>
      <ChevronLeft size={15} className="text-gray-300 flex-shrink-0" aria-hidden="true" />
    </motion.button>
  );
}

// ─── Combined day + slot picker (single step) ───────────────────────────────
// Always renders all 3 candidate day cards. Days with zero available shifts
// render greyed-out so the customer sees them and understands they're full.
// Inside an available day, every shift renders — disabled shifts show their
// reason; tapping them is a no-op. The submit() guard also re-checks
// `available` so a bypassed UI cannot push an invalid date through.
function WhenPicker({
  days,
  selectedDate,
  selectedShift,
  onPick,
}: {
  days: { date: string; shifts: { shift: Shift; labelAr: string; startHour: number; endHour: number; available: boolean; unavailableReason?: string }[]; available: boolean }[];
  selectedDate: string;
  selectedShift: Shift | null;
  onPick: (date: string, shift: Shift) => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const offsetTag = (date: string) => {
    const d = new Date(date + "T00:00:00");
    const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (diff === 0) return "اليوم";
    if (diff === 1) return "غداً";
    if (diff === 2) return "بعد غد";
    return null;
  };
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#164E63] font-medium">اختر يوماً وفترة من الأيام المتاحة.</p>
      {days.map((day) => {
        const tag = offsetTag(day.date);
        const dObj = new Date(day.date + "T00:00:00");
        const dayDisabled = !day.available;
        return (
          <div
            key={day.date}
            aria-disabled={dayDisabled}
            className={`rounded-2xl border p-3 ${
              dayDisabled ? "border-gray-100 bg-gray-50/60 opacity-70" : "border-gray-100 bg-white"
            }`}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${dayDisabled ? "bg-gray-100" : "bg-[#ECFEFF]"}`}>
                  <span className={`text-sm font-bold lat ${dayDisabled ? "text-gray-400" : "text-[#0891B2]"}`} dir="ltr">{dObj.getDate()}</span>
                </div>
                <div>
                  <p className={`text-sm font-bold ${dayDisabled ? "text-gray-400" : "text-[#164E63]"}`}>{WEEKDAYS_AR[dObj.getDay()]}</p>
                  <p className="text-[11px] text-gray-400">{formatDate(day.date)}</p>
                </div>
              </div>
              {tag && (
                <span className={`text-[10px] font-semibold rounded-full px-2 py-1 ${
                  dayDisabled ? "text-gray-400 bg-gray-100" : "text-[#0891B2] bg-[#ECFEFF]"
                }`}>
                  {tag}
                </span>
              )}
            </div>
            {dayDisabled && (
              <p className="text-[11px] text-amber-600 px-1 mb-2">لا توجد مواعيد متاحة في هذا اليوم.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {day.shifts.map((s) => {
                const isSelected = selectedDate === day.date && selectedShift === s.shift;
                const slotDisabled = !s.available;
                return (
                  <motion.button
                    key={s.shift}
                    whileTap={{ scale: slotDisabled ? 1 : 0.97 }}
                    onClick={() => { if (!slotDisabled) onPick(day.date, s.shift); }}
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
          </div>
        );
      })}
    </div>
  );
}
