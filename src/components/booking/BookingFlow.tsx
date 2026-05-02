"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { MapPin, User, Clock, ChevronLeft, Plus, Calendar as CalendarIcon } from "lucide-react";
import { getShiftConfigs } from "@/lib/mock-data";
import { usePatients, useAddresses, upsertPatient, upsertAddress } from "@/lib/profile";
import { useToast } from "@/components/ui/Toast";
import { useSystemSettings } from "@/lib/system-settings";
import { useOrders } from "@/lib/store";
import { getShiftLabel, formatDate } from "@/lib/utils";
import type { Test, Package, Shift, Address, Patient } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { BackButton } from "@/components/ui/BackButton";

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

  // Default visit date = today. Customer must explicitly confirm (the date row
  // is required just like shift), but they don't have to manually pick today.
  const [visitDate, setVisitDate] = useState<string>(() => ymd(new Date()));
  const [shift, setShift] = useState<Shift | null>(null);
  const [address, setAddress] = useState<Address | null>(allAddresses.find((a) => a.isDefault) ?? allAddresses[0] ?? null);
  const [patient, setPatient] = useState<Patient | null>(allPatients.find((p) => p.isDefault) ?? allPatients[0] ?? null);
  const [dateSheet, setDateSheet] = useState(false);
  const [shiftSheet, setShiftSheet] = useState(false);
  const [addressSheet, setAddressSheet] = useState(false);
  const [patientSheet, setPatientSheet] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [addingPatient, setAddingPatient] = useState(false);
  const toast = useToast();

  // Resolve shifts for the selected date, taking into account min-notice +
  // per-shift capacity from the live orders set.
  const ordersForDate = liveOrders
    .filter((o) => o.visitDate === visitDate)
    .map((o) => ({ shift: o.shift, status: o.status }));
  const shifts = getShiftConfigs({
    date: visitDate,
    minNoticeMinutes: settings.minBookingNoticeMinutes,
    morningStart: settings.morningShiftStart,
    morningEnd:   settings.morningShiftEnd,
    eveningStart: settings.eveningShiftStart,
    eveningEnd:   settings.eveningShiftEnd,
    ordersForDate,
    maxOrdersPerShift: settings.maxOrdersPerShift,
    bookingWindowDays: settings.bookingWindowDays,
  });

  const canContinue = shift && address && patient && visitDate;

  const submit = () => {
    if (!canContinue) return;
    const sCfg = shifts.find((x) => x.shift === shift);
    // Logic guard: even if the UI was bypassed, refuse a date/shift that
    // getShiftConfigs() considers unavailable (out-of-window, past, or
    // inside the min-notice cushion).
    if (!sCfg?.available) {
      toast.error("هذا الموعد غير متاح، يرجى اختيار وقت آخر");
      return;
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

        {/* Date */}
        <SectionRow
          icon={<CalendarIcon size={18} className="text-[#0891B2]" />}
          title="تاريخ الزيارة"
          value={visitDate ? `${WEEKDAYS_AR[new Date(visitDate + "T00:00:00").getDay()]} · ${formatDate(visitDate)}` : null}
          placeholder="اختر التاريخ"
          required
          onClick={() => setDateSheet(true)}
        />

        {/* Shift — depends on date */}
        <SectionRow
          icon={<Clock size={18} className="text-[#0891B2]" />}
          title="فترة الزيارة"
          value={shift ? getShiftLabel(shift) : null}
          placeholder={visitDate ? "اختر الفترة الزمنية" : "اختر التاريخ أولاً"}
          required
          onClick={() => { if (visitDate) setShiftSheet(true); }}
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

        {/* Patient */}
        <SectionRow
          icon={<User size={18} className="text-purple-600" />}
          title="اسم المريض"
          value={patient?.name ?? null}
          placeholder="اختر أو أضف مريضاً"
          required
          onClick={() => setPatientSheet(true)}
        />

        <p className="text-xs text-gray-400 px-1 leading-relaxed">
          سيتحقق الممرض من هوية المريض عند الوصول.
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

      {/* Date Sheet — visible window of N days starting today */}
      <BottomSheet open={dateSheet} onClose={() => setDateSheet(false)} title="تاريخ الزيارة">
        <div className="px-4 py-4">
          <DateGrid
            windowDays={settings.bookingWindowDays}
            selected={visitDate}
            onPick={(d) => {
              setVisitDate(d);
              // Reset shift if it became unavailable on the new date.
              setShift(null);
              setDateSheet(false);
              setShiftSheet(true);
            }}
          />
        </div>
      </BottomSheet>

      {/* Shift Sheet */}
      <BottomSheet open={shiftSheet} onClose={() => setShiftSheet(false)} title="موعد الزيارة">
        <div className="px-4 py-4 space-y-3">
          {shifts.every((s) => !s.available) && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-sm font-semibold text-amber-700">لا توجد مواعيد متاحة في هذا اليوم.</p>
              <p className="text-[11px] text-amber-700/80 mt-1 leading-relaxed">جرّب اختيار يوم آخر من الأيام المتاحة.</p>
            </div>
          )}
          {shifts.map((s) => {
            const isSelected = shift === s.shift;
            return (
              <motion.button
                key={s.shift}
                whileTap={{ scale: 0.97 }}
                onClick={() => { if (s.available) { setShift(s.shift); setShiftSheet(false); } }}
                disabled={!s.available}
                aria-pressed={isSelected}
                aria-disabled={!s.available}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-150 ${
                  isSelected ? "border-[#0891B2] bg-[#ECFEFF]" : s.available ? "border-gray-200 bg-white active:bg-gray-50" : "border-gray-100 bg-gray-50/80 opacity-60 cursor-not-allowed"
                }`}
              >
                {/* Shift icon — SVG, no emoji */}
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${s.shift === "morning" ? "bg-amber-50" : "bg-indigo-50"}`}>
                  {s.shift === "morning" ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                  )}
                </div>
                <div className="flex-1 text-start">
                  <p className="text-sm font-bold text-[#164E63]">{s.labelAr}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.shift === "morning" ? "8:00 – 10:00 صباحاً" : "4:00 – 6:00 مساءً"}
                  </p>
                  {!s.available && (
                    <p className="text-xs text-red-500 mt-1">{s.unavailableReason}</p>
                  )}
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${isSelected ? "border-[#0891B2] bg-[#0891B2]" : "border-gray-300"}`}>
                  {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                </div>
              </motion.button>
            );
          })}
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
      <BottomSheet open={patientSheet} onClose={() => setPatientSheet(false)} title="المريض">
        <div className="px-4 py-4 space-y-2">
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
          onSubmit={(a) => {
            upsertAddress(a);
            setAddress(a);
            setAddingAddress(false);
            toast.success("تم الحفظ بنجاح");
          }}
        />
      </BottomSheet>

      {/* Inline add-patient */}
      <BottomSheet open={addingPatient} onClose={() => setAddingPatient(false)} title="إضافة مريض">
        <PatientInlineForm
          onCancel={() => setAddingPatient(false)}
          onSubmit={(p) => {
            upsertPatient(p);
            setPatient(p);
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
  return (
    <div className="px-4 pb-4 space-y-3">
      <Field label="التسمية">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="المنزل / العمل" className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
      </Field>
      <Field label="العنوان">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="الحي، الشارع، رقم البناء، الطابق" className="w-full p-3 rounded-xl border border-gray-200 text-sm resize-none" />
      </Field>
      <Field label="المدينة">
        <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
          <option value="دمشق">دمشق</option>
          <option value="ريف دمشق">ريف دمشق</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-[#164E63]">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="w-4 h-4" />
        اجعله العنوان الافتراضي
      </label>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
        <Button
          variant="primary" className="flex-1"
          disabled={!label.trim() || !description.trim()}
          onClick={() => onSubmit({
            id: `addr-${Date.now()}`,
            userId: "u-1",
            label: label.trim(),
            description: description.trim(),
            lat: 33.5138, lng: 36.2765,
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
      <Field label="اسم المريض">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
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
            userId: "u-1",
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

// ─── Date grid: today + windowDays additional days ──────────────────────────
function DateGrid({ windowDays, selected, onPick }: {
  windowDays: number;
  selected: string;
  onPick: (date: string) => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cells = Math.max(1, windowDays + 1);
  const days: { date: string; day: number; weekday: string; isToday: boolean; offset: number }[] = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      date: ymd(d),
      day: d.getDate(),
      weekday: WEEKDAYS_AR[d.getDay()].slice(0, 3),
      isToday: i === 0,
      offset: i,
    });
  }
  const labelFor = (offset: number) => {
    if (offset === 0) return "اليوم";
    if (offset === 1) return "غداً";
    if (offset === 2) return "بعد غد";
    return null;
  };
  return (
    <div>
      <p className="text-[12px] text-[#164E63] font-medium mb-1">يمكنك اختيار موعد خلال الأيام المتاحة فقط.</p>
      <p className="text-[11px] text-gray-400 mb-2">
        {windowDays === 0
          ? "متاح اليوم فقط"
          : `متاح اليوم وحتى ${windowDays} ${windowDays === 1 ? "يوم" : "أيام"} لاحقاً`}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {days.map((d) => {
          const active = d.date === selected;
          const tag = labelFor(d.offset);
          return (
            <button
              key={d.date}
              onClick={() => onPick(d.date)}
              aria-pressed={active}
              className={`flex flex-col items-center justify-center py-3 rounded-xl border-2 cursor-pointer transition-all ${
                active ? "border-[#0891B2] bg-[#ECFEFF] text-[#0891B2]" : "border-gray-200 bg-white text-[#164E63] active:bg-gray-50"
              }`}
            >
              <span className="text-[10px] font-medium opacity-70">{d.weekday}</span>
              <span className="text-lg font-bold lat" dir="ltr">{d.day}</span>
              {tag && <span className="text-[9px] font-semibold mt-0.5">{tag}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
