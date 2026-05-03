"use client";
import { useMemo, useState } from "react";
import {
  Plus, Search, Eye, X, MapPin, Phone, Mail, Building2,
  ClipboardList, Image as ImageIcon, ChevronLeft, AlertTriangle,
  RotateCcw, CheckCircle2, FileText, Pencil, Trash2, Download,
} from "lucide-react";
import Image from "next/image";
import type { Lab, LabBranding, Order, LabUser } from "@/lib/types";
import { LAB_USER_ROLE_LABELS } from "@/lib/types";
import { MOCK_LABS, LAB_ISSUE_REASONS } from "@/lib/mock-data";
import { useOrders, resolveLabIssue, assignLab, updateLabIssueCustomerMessage } from "@/lib/store";
import { logActivity } from "@/lib/activity-log";
import {
  useLabUsers, upsertLabUser, deleteLabUser, setLabUserActive, resetLabUserPassword,
} from "@/lib/auth";
import { useSettlementsForLab, generateSettlement, setSettlementStatus } from "@/lib/settlements";
import { useToast } from "@/components/ui/Toast";
import { checkPassword, PASSWORD_HINT_AR } from "@/lib/password-policy";
import { formatDate, formatPrice, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CredentialsShareSheet, generateTempPassword, type ShareableCredentials } from "@/components/admin/CredentialsShareSheet";
import { MediaPicker } from "@/components/admin/MediaPicker";

interface Props {
  adminId: string;
  adminName: string;
  adminRole: import("@/lib/types").AdminRole;
}

export function LabsAdmin({ adminId, adminName, adminRole }: Props) {
  const [labs, setLabs] = useState<Lab[]>(MOCK_LABS);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<Lab | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Lab | null>(null);
  const orders = useOrders();
  const toast = useToast();

  const filtered = useMemo(() => labs.filter((l) => {
    if (statusFilter === "active" && !l.isActive) return false;
    if (statusFilter === "inactive" && l.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.nameAr.includes(search) || l.nameEn.toLowerCase().includes(q) || (l.city ?? "").includes(search);
    }
    return true;
  }), [labs, search, statusFilter]);

  const open = openId ? labs.find((l) => l.id === openId) ?? null : null;

  const upsert = (next: Lab) => {
    setLabs((prev) => {
      const idx = prev.findIndex((l) => l.id === next.id);
      if (idx === -1) return [...prev, next];
      const copy = prev.slice();
      copy[idx] = next;
      return copy;
    });
    logActivity({
      adminId, adminName, role: adminRole,
      action: "settings_change",
      entity: "lab", entityId: next.id,
      details: editing ? `تعديل بيانات المخبر ${next.nameAr}` : `إضافة مخبر ${next.nameAr}`,
    });
    toast.success("تم الحفظ بنجاح");
    setEditing(null); setCreating(false);
  };

  const toggleActive = (lab: Lab) => {
    setLabs((p) => p.map((l) => l.id === lab.id ? { ...l, isActive: !l.isActive } : l));
    logActivity({
      adminId, adminName, role: adminRole, action: "settings_change",
      entity: "lab", entityId: lab.id,
      details: lab.isActive ? `إيقاف المخبر ${lab.nameAr}` : `تفعيل المخبر ${lab.nameAr}`,
    });
    toast.success(lab.isActive ? "تم الإيقاف" : "تم التفعيل");
  };

  const remove = (lab: Lab) => {
    setLabs((p) => p.filter((l) => l.id !== lab.id));
    logActivity({
      adminId, adminName, role: adminRole, action: "settings_change",
      entity: "lab", entityId: lab.id, details: `حذف المخبر ${lab.nameAr}`,
    });
    toast.success("تم الحذف");
    setConfirmDelete(null);
  };

  const updateBranding = (labId: string, branding: LabBranding) => {
    setLabs((p) => p.map((l) => l.id === labId ? { ...l, branding } : l));
    logActivity({
      adminId, adminName, role: adminRole, action: "settings_change",
      entity: "lab", entityId: labId, details: "تعديل تصميم بوابة المخبر",
    });
    toast.success("تم حفظ التصميم");
  };

  if (open) {
    return (
      <LabDetail
        lab={open}
        orders={orders}
        labs={labs}
        adminRef={{ adminId, adminName, role: adminRole }}
        onBack={() => setOpenId(null)}
        onEdit={() => setEditing(open)}
        onBrandingChange={(b) => updateBranding(open.id, b)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" aria-hidden="true" />
          <input
            type="text" placeholder="بحث بالاسم أو المدينة"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 ps-9 pe-3 rounded-xl border border-gray-200 text-sm focus:border-[#0891B2] outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-10 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer"
          aria-label="تصفية الحالة"
        >
          <option value="all">كل المخابر</option>
          <option value="active">نشطة</option>
          <option value="inactive">موقوفة</option>
        </select>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden="true" />
          إضافة مخبر
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="text-start py-2 px-2 font-semibold">المخبر</th>
              <th className="text-start py-2 px-2 font-semibold">المدينة</th>
              <th className="text-start py-2 px-2 font-semibold">الهاتف</th>
              <th className="text-start py-2 px-2 font-semibold">الطلبات</th>
              <th className="text-start py-2 px-2 font-semibold">الحالة</th>
              <th className="text-end py-2 px-2 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-8 text-sm">لا توجد مخابر</td></tr>
            )}
            {filtered.map((l) => {
              const ord = orders.filter((o) => o.labId === l.id);
              return (
                <tr key={l.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2.5">
                      {l.logo ? (
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 relative flex-shrink-0">
                          <Image src={l.logo} alt="" fill sizes="36px" className="object-cover" />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-[#ECFEFF] flex items-center justify-center flex-shrink-0">
                          <Building2 size={16} className="text-[#0891B2]" aria-hidden="true" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#164E63] truncate">{l.nameAr}</p>
                        <p className="text-[11px] text-gray-400 lat truncate" dir="ltr">{l.nameEn}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-xs text-gray-500">{l.city ?? "—"}</td>
                  <td className="py-3 px-2 text-xs lat" dir="ltr">{l.phoneMain}</td>
                  <td className="py-3 px-2 text-xs">{ord.length}</td>
                  <td className="py-3 px-2">{l.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill>}</td>
                  <td className="py-3 px-2 text-end">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => setOpenId(l.id)} className="text-xs px-2 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer flex items-center gap-1">
                        <Eye size={12} aria-hidden="true" /> فتح
                      </button>
                      <button onClick={() => toggleActive(l)} className={`text-[10px] px-2 py-1 rounded-md cursor-pointer ${l.isActive ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {l.isActive ? "إيقاف" : "تفعيل"}
                      </button>
                      <button onClick={() => setEditing(l)} aria-label="تعديل" className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center cursor-pointer">
                        <Pencil size={13} className="text-gray-500" aria-hidden="true" />
                      </button>
                      <button onClick={() => setConfirmDelete(l)} aria-label="حذف" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">
                        <Trash2 size={13} className="text-red-400" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <LabFormModal
          initial={editing ?? undefined}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={upsert}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="حذف المخبر"
          message={`حذف "${confirmDelete.nameAr}"؟ لن يتأثر تاريخ الطلبات.`}
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => remove(confirmDelete)}
        />
      )}
    </div>
  );
}

// ─── Lab Detail (Overview / Stats / Orders / Branding) ────────────────────────
function LabDetail({ lab, orders, labs, adminRef, onBack, onEdit, onBrandingChange }: {
  lab: Lab;
  orders: Order[];
  labs: Lab[];
  adminRef: { adminId: string; adminName: string; role: import("@/lib/types").AdminRole };
  onBack: () => void;
  onEdit: () => void;
  onBrandingChange: (b: LabBranding) => void;
}) {
  const [tab, setTab] = useState<"overview" | "stats" | "orders" | "branding" | "users" | "settlements">("overview");
  const labOrders = useMemo(() => orders.filter((o) => o.labId === lab.id), [orders, lab.id]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-4">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer flex-shrink-0" aria-label="رجوع">
          <ChevronLeft size={16} className="rotate-180 text-[#164E63]" aria-hidden="true" />
        </button>
        {lab.logo ? (
          <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 relative flex-shrink-0">
            <Image src={lab.logo} alt="" fill sizes="56px" className="object-cover" />
          </div>
        ) : (
          <div className="w-14 h-14 rounded-xl bg-[#ECFEFF] flex items-center justify-center flex-shrink-0">
            <Building2 size={22} className="text-[#0891B2]" aria-hidden="true" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[#164E63] truncate">{lab.nameAr}</h2>
            {lab.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill>}
          </div>
          <p className="text-xs text-gray-400 lat mt-0.5" dir="ltr">{lab.nameEn}</p>
          <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-gray-500">
            {lab.city && <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{lab.city}{lab.area ? ` · ${lab.area}` : ""}</span>}
            <span className="inline-flex items-center gap-1 lat" dir="ltr"><Phone size={11} aria-hidden="true" />{lab.phoneMain}</span>
            {lab.email && <span className="inline-flex items-center gap-1 lat" dir="ltr"><Mail size={11} aria-hidden="true" />{lab.email}</span>}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil size={13} aria-hidden="true" />
          تعديل البيانات
        </Button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 px-1 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {([
          { v: "overview"    as const, label: "عام", Icon: Building2 },
          { v: "stats"       as const, label: "إحصائيات", Icon: ClipboardList },
          { v: "orders"      as const, label: `الطلبات (${labOrders.length})`, Icon: FileText },
          { v: "users"       as const, label: "مستخدمو المخبر", Icon: Building2 },
          { v: "settlements" as const, label: "التسويات", Icon: ClipboardList },
          { v: "branding"    as const, label: "تصميم البوابة", Icon: ImageIcon },
        ]).map((t) => {
          const active = tab === t.v;
          return (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                active ? "border-[#0891B2] text-[#0891B2]" : "border-transparent text-gray-500 hover:text-[#164E63]"
              }`}
            >
              <t.Icon size={13} className={active ? "text-[#0891B2]" : "text-gray-400"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview"    && <LabOverview lab={lab} />}
      {tab === "stats"       && <LabStats lab={lab} orders={labOrders} />}
      {tab === "orders"      && <LabOrders lab={lab} labs={labs} orders={labOrders} adminRef={adminRef} />}
      {tab === "users"       && <LabUsersTab lab={lab} adminRef={adminRef} />}
      {tab === "settlements" && <LabSettlementsTab lab={lab} adminRef={adminRef} />}
      {tab === "branding"    && <LabBrandingEditor lab={lab} onChange={onBrandingChange} />}
    </div>
  );
}

function LabOverview({ lab }: { lab: Lab }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card title="البيانات الرسمية">
        <Row label="الاسم الرسمي" value={lab.officialName ?? "—"} />
        <Row label="رقم السجل" value={lab.registrationNumber ?? "—"} />
        <Row label="رقم الترخيص" value={lab.licenseNumber ?? "—"} />
        <Row label="الرقم الضريبي" value={lab.taxNumber ?? "—"} />
        <Row label="العنوان" value={lab.addressFull ?? "—"} />
        {lab.lat != null && lab.lng != null && (
          <a
            href={`https://www.google.com/maps?q=${lab.lat},${lab.lng}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0891B2] mt-1"
          >
            <MapPin size={12} aria-hidden="true" />
            فتح في الخرائط
          </a>
        )}
      </Card>

      <Card title="التواصل">
        <Row label="الهاتف الرئيسي" value={<span className="lat" dir="ltr">{lab.phoneMain}</span>} />
        <Row label="هاتف ثانوي" value={lab.phoneSecondary ? <span className="lat" dir="ltr">{lab.phoneSecondary}</span> : "—"} />
        <Row label="البريد" value={lab.email ?? "—"} />
        <Row label="واتساب" value={lab.whatsapp ? <span className="lat" dir="ltr">{lab.whatsapp}</span> : "—"} />
      </Card>

      <Card title="ممثل المخبر">
        <Row label="الاسم" value={lab.representative?.fullName ?? "—"} />
        <Row label="المنصب" value={lab.representative?.role ?? "—"} />
        <Row label="الهاتف" value={lab.representative?.phone ? <span className="lat" dir="ltr">{lab.representative.phone}</span> : "—"} />
        <Row label="البريد" value={lab.representative?.email ?? "—"} />
      </Card>

      <Card title="الإعدادات التشغيلية">
        <Row label="المدن المخدومة" value={lab.supportedCities?.join("، ") || "—"} />
        <Row label="ساعات العمل" value={lab.workingHours ?? "—"} />
        <Row label="أنواع العينات" value={lab.acceptedSampleTypes?.join("، ") || "—"} />
        <Row label="متوسط مدة المعالجة" value={lab.avgProcessingHours ? `${lab.avgProcessingHours} ساعات` : "—"} />
      </Card>
    </div>
  );
}

function LabStats({ orders }: { lab: Lab; orders: Order[] }) {
  const total = orders.length;
  const inProgress = orders.filter((o) => ["sent_to_lab", "lab_processing"].includes(o.status)).length;
  const done = orders.filter((o) => ["result_ready", "completed"].includes(o.status)).length;
  const issues = orders.filter((o) => o.status === "lab_issue" || (o.issues?.length ?? 0) > 0).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="إجمالي الطلبات" value={total} color="bg-cyan-50 text-cyan-700" />
      <StatCard label="قيد المعالجة" value={inProgress} color="bg-amber-50 text-amber-700" />
      <StatCard label="مكتمل" value={done} color="bg-emerald-50 text-emerald-700" />
      <StatCard label="بمشاكل" value={issues} color="bg-red-50 text-red-600" />
    </div>
  );
}

function LabOrders({ lab, labs, orders, adminRef }: {
  lab: Lab; labs: Lab[]; orders: Order[];
  adminRef: { adminId: string; adminName: string; role: import("@/lib/types").AdminRole };
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [city, setCity] = useState<string>("all");
  const [date, setDate] = useState<string>("");

  const cities = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => set.add(o.address.city));
    return Array.from(set);
  }, [orders]);

  const filtered = orders.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (city !== "all" && o.address.city !== city) return false;
    if (date && o.visitDate !== date) return false;
    return true;
  });

  const reassign = (orderId: string) => {
    const id = window.prompt(
      "أدخل معرّف المخبر الجديد:\n" + labs.map((l) => `${l.id} — ${l.nameAr}`).join("\n"),
      lab.id,
    );
    if (id && id !== lab.id) {
      assignLab(orderId, id, { actor: "admin", actorName: adminRef.adminName });
      logActivity({
        adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
        action: "order_update", entity: "order", entityId: orderId,
        details: `إعادة إسناد المخبر إلى ${id}`,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer">
          <option value="all">كل الحالات</option>
          <option value="sent_to_lab">أُرسلت للمخبر</option>
          <option value="lab_processing">قيد المعالجة</option>
          <option value="result_ready">النتيجة جاهزة</option>
          <option value="completed">مكتمل</option>
          <option value="lab_issue">بمشكلة</option>
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer">
          <option value="all">كل المدن</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="text-start py-2 px-3 font-semibold">رقم</th>
              <th className="text-start py-2 px-3 font-semibold">المريض</th>
              <th className="text-start py-2 px-3 font-semibold">المدينة</th>
              <th className="text-start py-2 px-3 font-semibold">الموعد</th>
              <th className="text-start py-2 px-3 font-semibold">الحالة</th>
              <th className="text-start py-2 px-3 font-semibold">النتيجة</th>
              <th className="text-end py-2 px-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-6 text-xs">لا توجد طلبات تطابق التصفية</td></tr>
            )}
            {filtered.map((o) => {
              const hasResult = (o.resultFiles?.filter((f) => f.isActive)?.length ?? 0) > 0;
              return (
                <tr key={o.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2.5 px-3 text-xs lat" dir="ltr">{o.id}</td>
                  <td className="py-2.5 px-3 text-xs">{o.patient.name}</td>
                  <td className="py-2.5 px-3 text-xs">{o.address.city}</td>
                  <td className="py-2.5 px-3 text-xs">{formatDate(o.visitDate)} · {o.shift === "morning" ? "ص" : "م"}</td>
                  <td className="py-2.5 px-3"><StatusBadge status={o.status} /></td>
                  <td className="py-2.5 px-3">
                    {hasResult ? <Pill color="green">مرفوعة</Pill> : <Pill color="gray">لم تُرفع</Pill>}
                  </td>
                  <td className="py-2.5 px-3 text-end">
                    <button onClick={() => reassign(o.id)} className="text-[10px] px-2 py-1 rounded-md bg-amber-50 text-amber-700 cursor-pointer">
                      إعادة إسناد
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Issues across this lab's orders */}
      <Card title="مشاكل المخبر">
        {(() => {
          const allIssues = orders.flatMap((o) => (o.issues ?? []).map((i) => ({ ...i, _orderPatient: o.patient.name })));
          if (allIssues.length === 0) return <p className="text-xs text-gray-400 py-1">لا توجد مشاكل مسجّلة</p>;
          return (
            <ul className="space-y-2">
              {allIssues.map((i) => (
                <li key={i.id} className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle size={14} className={i.status === "resolved" ? "text-emerald-500 mt-0.5" : "text-amber-500 mt-0.5"} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-bold text-[#164E63]">
                        {LAB_ISSUE_REASONS.find((r) => r.value === i.type)?.labelAr ?? i.type}
                        <span className="text-gray-400 font-normal lat ms-1" dir="ltr">· {i.orderId}</span>
                      </p>
                      <span className="text-[10px] text-gray-400">{relativeTime(i.createdAt)}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{i.description}</p>
                    {/* Customer-facing message editor */}
                    <button
                      onClick={() => {
                        const next = window.prompt("الرسالة التي يراها العميل:", i.customerMessageAr ?? "حدثت مشكلة في العينة، وسيتم التواصل معك من فريق الدعم.");
                        if (next !== null) {
                          updateLabIssueCustomerMessage(i.id, next.trim());
                          logActivity({
                            adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
                            action: "order_update", entity: "lab_issue", entityId: i.id,
                            details: `تعديل رسالة العميل لمشكلة ${i.orderId}`,
                          });
                        }
                      }}
                      className="mt-1.5 text-[10px] text-[#0891B2] font-semibold cursor-pointer"
                    >
                      {i.customerMessageAr ? "تعديل رسالة العميل" : "تعيين رسالة للعميل"}
                    </button>
                  </div>
                  {i.status !== "resolved" ? (
                    <button onClick={() => {
                      const note = window.prompt("ملاحظة الحل:", "");
                      if (note !== null) {
                        resolveLabIssue(i.id, note, { actor: "admin", actorName: adminRef.adminName });
                        logActivity({
                          adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
                          action: "order_update", entity: "lab_issue", entityId: i.id,
                          details: `حل مشكلة المخبر — ${i.orderId}`,
                        });
                      }
                    }} className="text-[10px] px-2 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer flex items-center gap-1 flex-shrink-0">
                      <RotateCcw size={11} aria-hidden="true" /> حل
                    </button>
                  ) : (
                    <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ul>
          );
        })()}
      </Card>
    </div>
  );
}

function LabBrandingEditor({ lab, onChange }: { lab: Lab; onChange: (b: LabBranding) => void }) {
  const initial: LabBranding = lab.branding ?? {
    primaryColor: "#0891B2", secondaryColor: "#0E7490", accentColor: "#ECFEFF",
  };
  const [draft, setDraft] = useState<LabBranding>(initial);
  const set = <K extends keyof LabBranding>(k: K, v: LabBranding[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card title="هوية بصرية">
        <Field label="اسم البوابة">
          <input value={draft.portalDisplayName ?? ""} onChange={(e) => set("portalDisplayName", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
        </Field>
        <MediaPicker label="الشعار" value={draft.logo ?? ""} onChange={(url) => set("logo", url || undefined)} compact />
        <MediaPicker label="صورة الهيدر (اختياري)" value={draft.headerImage ?? ""} onChange={(url) => set("headerImage", url || undefined)} compact />
      </Card>

      <Card title="الألوان">
        <ColorField label="اللون الأساسي" value={draft.primaryColor} onChange={(v) => set("primaryColor", v)} />
        <ColorField label="اللون الثانوي" value={draft.secondaryColor} onChange={(v) => set("secondaryColor", v)} />
        <ColorField label="لون التمييز" value={draft.accentColor} onChange={(v) => set("accentColor", v)} />
      </Card>

      <div className="md:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-[11px] text-gray-400 uppercase mb-2">معاينة</p>
        <div
          className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: draft.accentColor, borderInline: `4px solid ${draft.primaryColor}` }}
        >
          {draft.logo ? (
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-white relative flex-shrink-0">
              <Image src={draft.logo} alt="" fill sizes="40px" className="object-cover" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: draft.primaryColor }}>
              <Building2 size={18} className="text-white" aria-hidden="true" />
            </div>
          )}
          <div>
            <p className="text-sm font-bold" style={{ color: draft.primaryColor }}>
              {draft.portalDisplayName || lab.nameAr}
            </p>
            <p className="text-[11px]" style={{ color: draft.secondaryColor }}>بوابة المخبر</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={() => setDraft(initial)}>إلغاء</Button>
          <Button size="sm" variant="primary" onClick={() => onChange(draft)}>حفظ التصميم</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Lab Users sub-tab ──────────────────────────────────────────────────────
function LabUsersTab({ lab, adminRef }: {
  lab: Lab;
  adminRef: { adminId: string; adminName: string; role: import("@/lib/types").AdminRole };
}) {
  const allUsers = useLabUsers();
  const users = allUsers.filter((u) => u.labId === lab.id);
  const [editing, setEditing] = useState<LabUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LabUser | null>(null);
  const [resetTarget, setResetTarget] = useState<LabUser | null>(null);
  const [shareCreds, setShareCreds] = useState<ShareableCredentials | null>(null);
  const toast = useToast();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-500">{users.length} مستخدم</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden="true" /> إضافة مستخدم
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="text-start py-2 px-3 font-semibold">الاسم</th>
              <th className="text-start py-2 px-3 font-semibold">المستخدم</th>
              <th className="text-start py-2 px-3 font-semibold">الصلاحية</th>
              <th className="text-start py-2 px-3 font-semibold">آخر دخول</th>
              <th className="text-start py-2 px-3 font-semibold">الحالة</th>
              <th className="text-end py-2 px-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6 text-xs">لا يوجد مستخدمون لهذا المخبر بعد</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 px-3 text-xs font-semibold text-[#164E63]">{u.fullName}</td>
                <td className="py-2.5 px-3 text-xs lat" dir="ltr">{u.username}</td>
                <td className="py-2.5 px-3 text-xs">{LAB_USER_ROLE_LABELS[u.role]}</td>
                <td className="py-2.5 px-3 text-xs text-gray-500">{u.lastLoginAt ? formatDate(u.lastLoginAt) : "—"}</td>
                <td className="py-2.5 px-3">{u.isActive ? <Pill color="green">نشط</Pill> : <Pill color="red">موقوف</Pill>}</td>
                <td className="py-2.5 px-3 text-end">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => { setLabUserActive(u.id, !u.isActive); toast.success(u.isActive ? "تم الإيقاف" : "تم التفعيل"); }}
                      className={`text-[10px] px-2 py-1 rounded-md cursor-pointer ${u.isActive ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
                    >
                      {u.isActive ? "إيقاف" : "تفعيل"}
                    </button>
                    <button onClick={() => setResetTarget(u)} aria-label="إعادة تعيين كلمة المرور" className="text-[10px] px-2 py-1 rounded-md bg-cyan-50 text-cyan-700 cursor-pointer">
                      إعادة كلمة المرور
                    </button>
                    <button onClick={() => setEditing(u)} aria-label="تعديل" className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center cursor-pointer">
                      <Pencil size={13} className="text-gray-500" aria-hidden="true" />
                    </button>
                    <button onClick={() => setConfirmDelete(u)} aria-label="حذف" className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer">
                      <Trash2 size={13} className="text-red-400" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <LabUserFormModal
          labId={lab.id}
          initial={editing ?? undefined}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={async (u) => {
            const isCreate = !editing;
            const r = await upsertLabUser(u);
            if (!r.ok) { toast.error(r.error ?? "تعذر الحفظ"); return; }
            logActivity({
              adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
              action: "user_edit", entity: "lab_user", entityId: r.id ?? u.id,
              details: editing ? `تعديل مستخدم المخبر ${u.fullName}` : `إضافة مستخدم مخبر ${u.fullName}`,
            });
            toast.success("تم الحفظ بنجاح");
            setEditing(null); setCreating(false);
            if (isCreate && u.password) {
              setShareCreds({
                roleLabel: LAB_USER_ROLE_LABELS[u.role],
                fullName: u.fullName,
                email: u.username,
                password: u.password,
                phone: (u as LabUser & { phone?: string }).phone,
              });
            }
          }}
        />
      )}

      {shareCreds && (
        <CredentialsShareSheet credentials={shareCreds} onClose={() => setShareCreds(null)} />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          onCancel={() => setResetTarget(null)}
          onConfirm={(pw) => {
            resetLabUserPassword(resetTarget.id, pw);
            logActivity({
              adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
              action: "user_edit", entity: "lab_user", entityId: resetTarget.id,
              details: `إعادة تعيين كلمة المرور للمستخدم ${resetTarget.fullName}`,
            });
            toast.success("تم تحديث كلمة المرور");
            setResetTarget(null);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="حذف المستخدم"
          message={`حذف المستخدم "${confirmDelete.fullName}"؟ لن يتمكن من الدخول بعد الآن.`}
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteLabUser(confirmDelete.id);
            logActivity({
              adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
              action: "user_edit", entity: "lab_user", entityId: confirmDelete.id,
              details: `حذف المستخدم ${confirmDelete.fullName}`,
            });
            toast.success("تم الحذف");
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function LabUserFormModal({ labId, initial, onCancel, onSubmit }: {
  labId: string;
  initial?: LabUser;
  onCancel: () => void;
  onSubmit: (u: LabUser & { phone?: string }) => void;
}) {
  // Empty id on new drafts — server returns the real UUID after create.
  // A pre-generated "lu-…" slug used to leak into the PATCH path and
  // produced "user id must be a uuid".
  const [d, setD] = useState<LabUser>(() => initial ?? {
    id: "", labId, username: "", password: "", fullName: "",
    role: "lab_uploader", isActive: true,
  });
  const [phone, setPhone] = useState<string>("");
  const set = <K extends keyof LabUser>(k: K, v: LabUser[K]) => setD((x) => ({ ...x, [k]: v }));

  // Password is only collected on create (resets go through ResetPasswordDialog).
  const passwordCheck = !initial ? checkPassword(d.password) : { ok: true, errors: [] as string[] };
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.username.trim());

  const canSubmit =
    d.fullName.trim().length > 0 &&
    emailValid &&
    (!!initial || passwordCheck.ok);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-[#164E63]">{initial ? "تعديل مستخدم" : "إضافة مستخدم"}</h3>
        <Field label="الاسم الكامل *">
          <input value={d.fullName} onChange={(e) => set("fullName", e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm" />
        </Field>
        <Field label="البريد الإلكتروني *">
          <input
            type="email"
            value={d.username}
            onChange={(e) => set("username", e.target.value)}
            placeholder="user@lab.com"
            className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm lat"
            dir="ltr"
          />
          {d.username && !emailValid && (
            <p className="text-[11px] text-red-500 mt-1">صيغة البريد غير صحيحة</p>
          )}
        </Field>
        <Field label="رقم الهاتف">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+963 9XX XXX XXX"
            className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm lat"
            dir="ltr"
          />
        </Field>
        {!initial && (
          <Field label="كلمة المرور المبدئية *">
            <div className="flex gap-2">
              <input
                value={d.password}
                onChange={(e) => set("password", e.target.value)}
                type="text"
                aria-invalid={d.password.length > 0 && !passwordCheck.ok}
                aria-describedby="lab-user-pw-hint"
                className={`flex-1 h-11 px-3 rounded-xl border text-sm lat ${d.password.length > 0 && !passwordCheck.ok ? "border-red-300 focus:border-red-400" : "border-gray-200 focus:border-[#0891B2]"} outline-none`}
                dir="ltr"
              />
              <Button variant="outline" size="sm" onClick={() => set("password", generateTempPassword())}>توليد</Button>
            </div>
            <p id="lab-user-pw-hint" className={`text-[11px] mt-1 leading-relaxed ${d.password.length > 0 && !passwordCheck.ok ? "text-red-600" : "text-gray-400"}`}>
              {d.password.length > 0 && !passwordCheck.ok
                ? `ينقص: ${passwordCheck.errors.join("، ")}`
                : PASSWORD_HINT_AR}
            </p>
          </Field>
        )}
        <Field label="الصلاحية">
          <select value={d.role} onChange={(e) => set("role", e.target.value as LabUser["role"])} className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm cursor-pointer">
            {(Object.entries(LAB_USER_ROLE_LABELS) as [LabUser["role"], string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-[#164E63]">
          <input type="checkbox" checked={d.isActive} onChange={(e) => set("isActive", e.target.checked)} className="w-4 h-4" />
          نشط
        </label>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" className="flex-1" disabled={!canSubmit} onClick={() => onSubmit({ ...d, phone: phone.trim() || undefined })}>
            حفظ
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ user, onCancel, onConfirm }: {
  user: LabUser;
  onCancel: () => void;
  onConfirm: (newPassword: string) => void;
}) {
  const [pw, setPw] = useState("");
  const check = checkPassword(pw);
  const invalid = pw.length > 0 && !check.ok;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-[#164E63]">إعادة تعيين كلمة المرور</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          ستحلّ محل كلمة المرور الحالية للمستخدم <span className="font-semibold text-[#164E63]">{user.fullName}</span>.
        </p>
        <Field label="كلمة المرور الجديدة">
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            type="text"
            aria-invalid={invalid}
            aria-describedby="lab-user-reset-hint"
            className={`w-full h-11 px-3 rounded-xl border text-sm lat ${invalid ? "border-red-300 focus:border-red-400" : "border-gray-200 focus:border-[#0891B2]"} outline-none`}
            dir="ltr"
          />
          <p id="lab-user-reset-hint" className={`text-[11px] mt-1 leading-relaxed ${invalid ? "text-red-600" : "text-gray-400"}`}>
            {invalid ? `ينقص: ${check.errors.join("، ")}` : PASSWORD_HINT_AR}
          </p>
        </Field>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
          <Button variant="primary" className="flex-1" disabled={!check.ok} onClick={() => onConfirm(pw)}>تحديث</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Lab Settlements sub-tab ───────────────────────────────────────────────
function LabSettlementsTab({ lab, adminRef }: {
  lab: Lab;
  adminRef: { adminId: string; adminName: string; role: import("@/lib/types").AdminRole };
}) {
  const settlements = useSettlementsForLab(lab.id);
  const [generating, setGenerating] = useState(false);
  const [periodStart, setPeriodStart] = useState(() => firstOfMonth());
  const [periodEnd, setPeriodEnd] = useState(() => lastOfMonth());
  const [notes, setNotes] = useState("");
  const toast = useToast();

  const generate = () => {
    setGenerating(true);
    const created = generateSettlement({ labId: lab.id, periodStart, periodEnd, notes: notes.trim() || undefined });
    setGenerating(false);
    if (!created) {
      toast.warning("لا توجد طلبات مكتملة في الفترة المحددة");
      return;
    }
    logActivity({
      adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
      action: "settings_change", entity: "lab_settlement", entityId: created.id,
      details: `توليد تسوية ${periodStart} → ${periodEnd} للمخبر ${lab.nameAr}`,
    });
    toast.success(`تم توليد تسوية بـ ${created.totalOrders} طلب`);
    setNotes("");
  };

  return (
    <div className="space-y-4">
      {/* Generator */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className="text-sm font-bold text-[#164E63] mb-3">توليد تسوية شهرية</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="من">
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
          </Field>
          <Field label="إلى">
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
          </Field>
          <Field label="ملاحظة (اختيارية)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-end">
          <Button variant="primary" size="sm" loading={generating} onClick={generate}>توليد التسوية</Button>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <header className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-[#164E63]">سجل التسويات ({settlements.length})</h3>
          <button
            onClick={() => exportSettlementsCsv(lab.nameAr, settlements)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 cursor-pointer flex items-center gap-1.5 active:bg-gray-50"
          >
            <Download size={13} aria-hidden="true" />
            تصدير CSV
          </button>
        </header>
        {settlements.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">لا توجد تسويات بعد</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-start py-2 px-3 font-semibold">الفترة</th>
                  <th className="text-start py-2 px-3 font-semibold">عدد الطلبات</th>
                  <th className="text-start py-2 px-3 font-semibold">المستحق</th>
                  <th className="text-start py-2 px-3 font-semibold">المدفوع</th>
                  <th className="text-start py-2 px-3 font-semibold">الحالة</th>
                  <th className="text-end py-2 px-3 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 px-3 text-xs lat" dir="ltr">{s.periodStart} → {s.periodEnd}</td>
                    <td className="py-2.5 px-3 text-xs">{s.totalOrders}</td>
                    <td className="py-2.5 px-3 text-xs">{formatPrice(s.totalLabAmount)}</td>
                    <td className="py-2.5 px-3 text-xs">{formatPrice(s.totalPaid)}</td>
                    <td className="py-2.5 px-3">
                      <Pill color={s.status === "paid" ? "green" : s.status === "partially_paid" ? "cyan" : "amber"}>
                        {s.status === "paid" ? "مدفوعة" : s.status === "partially_paid" ? "مدفوعة جزئياً" : "بانتظار الدفع"}
                      </Pill>
                    </td>
                    <td className="py-2.5 px-3 text-end">
                      {s.status !== "paid" && (
                        <button
                          onClick={() => {
                            setSettlementStatus(s.id, "paid");
                            logActivity({
                              adminId: adminRef.adminId, adminName: adminRef.adminName, role: adminRef.role,
                              action: "invoice_status", entity: "lab_settlement", entityId: s.id,
                              details: `تسوية ${s.periodStart} → ${s.periodEnd} مدفوعة`,
                            });
                            toast.success("تم تعليم التسوية مدفوعة");
                          }}
                          className="text-[10px] px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 cursor-pointer"
                        >
                          تعليم مدفوعة
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}
function lastOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
}

function exportSettlementsCsv(labName: string, settlements: import("@/lib/types").LabSettlement[]) {
  const rows = [
    ["period_start", "period_end", "total_orders", "total_lab_amount", "total_paid", "status"],
    ...settlements.map((s) => [s.periodStart, s.periodEnd, String(s.totalOrders), String(s.totalLabAmount), String(s.totalPaid), s.status]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${labName.replace(/\s+/g, "_")}-settlements.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Lab create/edit form ────────────────────────────────────────────────────
function LabFormModal({ initial, onCancel, onSubmit }: {
  initial?: Lab; onCancel: () => void; onSubmit: (l: Lab) => void;
}) {
  // useState lazy initializer keeps Date.now() out of render.
  const [d, setD] = useState<Lab>(() => initial ?? {
    id: `lab-${Date.now()}`,
    name: "", phone: "",
    nameAr: "", nameEn: "", isActive: true, phoneMain: "",
  });
  const set = <K extends keyof Lab>(k: K, v: Lab[K]) => setD((x) => ({ ...x, [k]: v }));
  const setRep = <K extends keyof NonNullable<Lab["representative"]>>(k: K, v: string) =>
    setD((x) => ({ ...x, representative: { fullName: "", role: "", phone: "", ...x.representative, [k]: v } }));

  const submit = () => {
    if (!d.nameAr.trim() || !d.phoneMain.trim()) return;
    onSubmit({ ...d, name: d.nameAr, phone: d.phoneMain });
  };

  return (
    // Side drawer (full-height slide-over from the start side in RTL).
    // Backdrop is click-to-close, body is a flex column with sticky header + footer.
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex">
      <button
        type="button" aria-label="إغلاق"
        onClick={onCancel}
        className="flex-1 bg-black/50 cursor-pointer"
      />
      <div className="bg-white w-full max-w-xl h-full overflow-hidden flex flex-col shadow-[0_0_40px_rgba(0,0,0,0.18)]">
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-[#164E63]">{initial ? "تعديل بيانات المخبر" : "إضافة مخبر جديد"}</h3>
          <button onClick={onCancel} aria-label="إغلاق" className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <Card title="معلومات أساسية">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="الاسم بالعربية *"><input value={d.nameAr} onChange={(e) => set("nameAr", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="الاسم بالإنجليزية"><input value={d.nameEn} onChange={(e) => set("nameEn", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <MediaPicker label="الشعار" value={d.logo ?? ""} onChange={(url) => set("logo", url || undefined)} compact />
              <Field label="الحالة">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={d.isActive} onChange={(e) => set("isActive", e.target.checked)} className="w-4 h-4" /> نشط
                </label>
              </Field>
            </div>
          </Card>

          <Card title="بيانات رسمية">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="الاسم الرسمي"><input value={d.officialName ?? ""} onChange={(e) => set("officialName", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="رقم السجل"><input value={d.registrationNumber ?? ""} onChange={(e) => set("registrationNumber", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <Field label="رقم الترخيص"><input value={d.licenseNumber ?? ""} onChange={(e) => set("licenseNumber", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <Field label="الرقم الضريبي"><input value={d.taxNumber ?? ""} onChange={(e) => set("taxNumber", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <Field label="العنوان الكامل"><input value={d.addressFull ?? ""} onChange={(e) => set("addressFull", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="المدينة"><input value={d.city ?? ""} onChange={(e) => set("city", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="المنطقة"><input value={d.area ?? ""} onChange={(e) => set("area", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="الإحداثيات (lat,lng)">
                <input
                  value={d.lat != null && d.lng != null ? `${d.lat},${d.lng}` : ""}
                  onChange={(e) => {
                    const [la, ln] = e.target.value.split(",").map((s) => Number(s.trim()));
                    if (!isNaN(la) && !isNaN(ln)) { set("lat", la); set("lng", ln); }
                    else { set("lat", undefined); set("lng", undefined); }
                  }}
                  placeholder="33.5138, 36.2765"
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr"
                />
              </Field>
            </div>
          </Card>

          <Card title="التواصل">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="الهاتف الرئيسي *"><input value={d.phoneMain} onChange={(e) => set("phoneMain", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <Field label="هاتف ثانوي"><input value={d.phoneSecondary ?? ""} onChange={(e) => set("phoneSecondary", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <Field label="البريد"><input value={d.email ?? ""} onChange={(e) => set("email", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <Field label="واتساب"><input value={d.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value || undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
            </div>
          </Card>

          <Card title="ممثل المخبر">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="الاسم الكامل"><input value={d.representative?.fullName ?? ""} onChange={(e) => setRep("fullName", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="المنصب"><input value={d.representative?.role ?? ""} onChange={(e) => setRep("role", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="الهاتف"><input value={d.representative?.phone ?? ""} onChange={(e) => setRep("phone", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
              <Field label="البريد"><input value={d.representative?.email ?? ""} onChange={(e) => setRep("email", e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" /></Field>
            </div>
          </Card>

          <Card title="الإعدادات التشغيلية">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="المدن المخدومة (مفصولة بفواصل)">
                <input value={(d.supportedCities ?? []).join("، ")} onChange={(e) => set("supportedCities", e.target.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean))} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
              </Field>
              <Field label="ساعات العمل"><input value={d.workingHours ?? ""} onChange={(e) => set("workingHours", e.target.value || undefined)} placeholder="8:00 – 20:00" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" /></Field>
              <Field label="أنواع العينات (مفصولة بفواصل)">
                <input value={(d.acceptedSampleTypes ?? []).join(", ")} onChange={(e) => set("acceptedSampleTypes", e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean))} placeholder="blood, urine" className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
              </Field>
              <Field label="متوسط مدة المعالجة (ساعات)">
                <input type="number" value={d.avgProcessingHours ?? ""} onChange={(e) => set("avgProcessingHours", e.target.value ? Number(e.target.value) : undefined)} className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
              </Field>
            </div>
          </Card>
        </div>
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <Button size="md" variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button size="md" variant="primary" onClick={submit} disabled={!d.nameAr.trim() || !d.phoneMain.trim()}>حفظ</Button>
        </footer>
      </div>
    </div>
  );
}

// ─── Local helpers ───────────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
        <h4 className="text-xs font-bold text-[#164E63]">{title}</h4>
      </header>
      <div className="p-4 space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="text-[#164E63] font-medium text-end break-words">{value}</span>
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm lat" dir="ltr" />
      </div>
    </Field>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-[11px] text-gray-400 font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 inline-block px-2 rounded-md ${color}`}>{value}</p>
    </div>
  );
}

function Pill({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "green" | "red" | "amber" | "cyan" }) {
  const map = {
    gray:  "bg-gray-100 text-gray-600",
    green: "bg-emerald-50 text-emerald-700",
    red:   "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
    cyan:  "bg-cyan-50 text-cyan-700",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[color]}`}>{children}</span>;
}

function ConfirmDialog({ title, message, danger, onConfirm, onCancel }: {
  title: string; message: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl p-5">
        <h3 className="text-sm font-bold text-[#164E63] mb-2">{title}</h3>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">{message}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
          <Button variant={danger ? "danger" : "primary"} className="flex-1" onClick={onConfirm}>تأكيد</Button>
        </div>
      </div>
    </div>
  );
}
