"use client";
import { useEffect, useMemo, useState } from "react";
import {
  X, ClipboardList, Package as PackageIcon, Settings as SettingsIcon, History,
  AlertTriangle, DollarSign, StickyNote, MapPin, User, Clock, Calendar,
  FileText, Upload, Trash2, CheckCircle2, UserCog, Building2, RotateCcw,
  Pencil, Tag, CreditCard, Send, Download, Plus, ChevronDown, RefreshCw,
} from "lucide-react";
import Image from "next/image";
import type {
  Order, Nurse, Lab, OrderEvent, OrderEventType,
  AdminRole, OrderNote, LabIssueType,
} from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/types";
import { FAILED_COLLECTION_REASONS, LAB_ISSUE_REASONS } from "@/lib/mock-data";
import { formatDate, formatPrice, getShiftLabel, relativeTime } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import {
  setOrderStatus, assignNurse, assignLab, applyCoupon, setPaymentStatus,
  uploadResultFile, archiveResultFile, restoreResultFile, openLabIssue, resolveLabIssue,
  confirmResultsReady, forceCompleteOrder,
  cancelOrder, rescheduleOrder, addNote, useOrders,
} from "@/lib/store";
import { logActivity } from "@/lib/activity-log";
import { useToast } from "@/components/ui/Toast";

type Tab = "overview" | "items" | "operations" | "timeline" | "issues" | "finance" | "notes";

const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

interface ControlCenterRole {
  /** Logical role driving permission checks. */
  role: AdminRole | "lab_user";
  /** Display name written into events/notes. */
  actorName: string;
  /** Lower-level actor type used for events. */
  actor: OrderEvent["actor"];
  /** Admin user id for activity-log entries. Optional for lab role. */
  adminId?: string;
}

function record(role: ControlCenterRole, action: import("@/lib/types").ActivityAction, entity: string, entityId: string, details: string) {
  if (!role.adminId || role.role === "lab_user") return;
  logActivity({
    adminId: role.adminId,
    adminName: role.actorName,
    role: role.role as AdminRole,
    action, entity, entityId, details,
  });
}

interface Props {
  order: Order;
  role: ControlCenterRole;
  nurses: Nurse[];
  labs: Lab[];
  onClose: () => void;
  /** Render inside the admin section (no modal scaffolding) instead of a dialog. */
  inline?: boolean;
  /** When provided, the Overview tab + sticky header show "عرض تفاصيل العميل"
   *  buttons that the admin parent should handle by pushing the user profile
   *  inline (with a back arrow returning to this OCC). */
  onOpenUser?: (userId: string) => void;
}

// Lab users see a focused subset; admins see everything.
const TABS_BY_ROLE: Record<string, Tab[]> = {
  lab_user: ["overview", "items", "operations", "timeline", "issues"],
  default:  ["overview", "items", "operations", "timeline", "issues", "finance", "notes"],
};

function tabsFor(role: ControlCenterRole["role"]): Tab[] {
  return TABS_BY_ROLE[role] ?? TABS_BY_ROLE.default;
}

function canEditPricing(role: ControlCenterRole["role"]): boolean {
  if (role === "lab_user") return false;
  const perms = ROLE_PERMISSIONS[role as AdminRole] ?? [];
  return perms.includes("*") || perms.includes("invoices") || perms.includes("orders");
}

const TAB_META: Record<Tab, { labelAr: string; Icon: React.FC<{ size?: number; className?: string }> }> = {
  overview:   { labelAr: "عام",         Icon: ClipboardList },
  items:      { labelAr: "العناصر",     Icon: PackageIcon },
  operations: { labelAr: "العمليات",    Icon: SettingsIcon },
  timeline:   { labelAr: "السجل",       Icon: History },
  issues:     { labelAr: "المشاكل",     Icon: AlertTriangle },
  finance:    { labelAr: "المالية",     Icon: DollarSign },
  notes:      { labelAr: "ملاحظات",     Icon: StickyNote },
};

export function OrderControlCenter({ order, role, nurses, labs, onClose, inline = false, onOpenUser }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs = tabsFor(role.role);
  const ref = { actor: role.actor, actorName: role.actorName };

  const body = (
    <>
      {/* Sticky header (with role-gated quick actions) */}
      <StickyHeader order={order} role={role} nurses={nurses} labs={labs} onClose={onClose} onOpenUser={onOpenUser} />

      {/* Tabs */}
      <div className="flex gap-1 px-4 md:px-5 border-b border-gray-100 overflow-x-auto no-scrollbar bg-white">
        {tabs.map((t) => {
          const meta = TAB_META[t];
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 px-3 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                active ? "border-[#0891B2] text-[#0891B2]" : "border-transparent text-gray-500 hover:text-[#164E63]"
              }`}
            >
              <meta.Icon size={14} className={active ? "text-[#0891B2]" : "text-gray-400"} />
              {meta.labelAr}
            </button>
          );
        })}
      </div>

      <div className={`overflow-y-auto p-4 md:p-5 ${inline ? "" : "flex-1"} bg-gray-50/40`}>
        {tab === "overview"   && <OverviewTab order={order} onOpenUser={onOpenUser} />}
        {tab === "items"      && <ItemsTab order={order} />}
        {tab === "operations" && <OperationsTab order={order} role={role} nurses={nurses} labs={labs} ref={ref} />}
        {tab === "timeline"   && <TimelineTab order={order} />}
        {tab === "issues"     && <IssuesTab order={order} role={role} ref={ref} />}
        {tab === "finance"    && <FinanceTab order={order} role={role} ref={ref} />}
        {tab === "notes"      && <NotesTab order={order} role={role} />}
      </div>
    </>
  );

  if (inline) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {body}
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`الطلب ${order.id}`} className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-3 md:p-6">
      <div className="bg-white w-full max-w-5xl rounded-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {body}
      </div>
    </div>
  );
}

// ─── Sticky header with role-gated quick actions ──────────────────────────────
function StickyHeader({ order, role, onClose, onOpenUser }: {
  order: Order; role: ControlCenterRole; nurses: Nurse[]; labs: Lab[]; onClose: () => void;
  onOpenUser?: (userId: string) => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const ref = { actor: role.actor, actorName: role.actorName };
  const isLab = role.role === "lab_user";
  const toast = useToast();

  return (
    <header className="px-4 md:px-5 py-3 border-b border-gray-100 bg-white flex-shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Public number — primary identifier; internal id stays available
                next to it for cross-system reference. */}
            {order.publicNumber && (
              <span className="text-sm font-bold text-[#164E63] lat" dir="ltr">{order.publicNumber}</span>
            )}
            <span className="text-[11px] text-gray-400 lat" dir="ltr">· {order.id}</span>
            <StatusBadge status={order.status} />
            {order.paymentStatus === "paid" && <Pill color="green">مدفوع</Pill>}
            {order.paymentStatus === "pending" && <Pill color="amber">دفع معلّق</Pill>}
            {order.paymentStatus === "failed" && <Pill color="red">فشل الدفع</Pill>}
          </div>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{order.address.city}</span>
            <span className="inline-flex items-center gap-1"><Calendar size={11} aria-hidden="true" />{formatDate(order.visitDate)}</span>
            <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" />{getShiftLabel(order.shift)}</span>
            <span className="font-bold text-[#164E63]">{formatPrice(order.total)}</span>
            {onOpenUser && !isLab && (
              <button
                onClick={() => onOpenUser(order.userId)}
                className="inline-flex items-center gap-1 text-[#0891B2] font-semibold cursor-pointer"
              >
                <User size={11} aria-hidden="true" />
                {order.patient.name}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="h-9 px-3 rounded-xl bg-[#ECFEFF] text-[#0891B2] text-xs font-semibold flex items-center gap-1 cursor-pointer active:bg-cyan-100"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
            >
              إجراءات سريعة
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {actionsOpen && (
              <div role="menu" className="absolute end-0 mt-1 w-64 bg-white rounded-xl border border-gray-100 shadow-lg z-10 py-1">
                {!isLab && (
                  <>
                    {/* Nurse + lab assignment is intentionally NOT in this
                       quick-actions menu anymore. Use the dropdowns under
                       the "Operations" tab — they read real DB rows so the
                       admin can never accidentally submit a stale id. */}
                    <ActionItem icon={RefreshCw} label="إعادة جدولة" onClick={async () => {
                      const date = window.prompt("تاريخ جديد (YYYY-MM-DD):", order.visitDate);
                      if (date) {
                        const r = await rescheduleOrder(order.id, date, order.shift, ref);
                        if (!r.ok) toast.error(r.error ?? "تعذر إعادة الجدولة");
                        else record(role, "order_update", "order", order.id, `إعادة جدولة → ${date}`);
                        setActionsOpen(false);
                      }
                    }} />
                    <ActionItem icon={Tag} label="تطبيق/إزالة كوبون" onClick={async () => {
                      const code = window.prompt("كود الكوبون (فارغ للإزالة):", order.couponCode ?? "");
                      if (code !== null) {
                        const disc = code ? Number(window.prompt("قيمة الخصم:", String(order.couponDiscount || 0)) || 0) : 0;
                        const r = await applyCoupon(order.id, code, disc, ref);
                        if (!r.ok) toast.error(r.error ?? "تعذر تحديث الكوبون");
                        else record(role, "coupon_change", "order", order.id, code ? `${code} -${disc}` : "إزالة الكوبون");
                        setActionsOpen(false);
                      }
                    }} />
                    <ActionItem icon={CreditCard} label="تغيير حالة الدفع" onClick={async () => {
                      const next = window.prompt("paid / pending / failed:", order.paymentStatus);
                      if (next === "paid" || next === "pending" || next === "failed") {
                        const r = await setPaymentStatus(order.id, next, ref);
                        if (!r.ok) toast.error(r.error ?? "تعذر تغيير حالة الدفع");
                        else record(role, "invoice_status", "order", order.id, `حالة الدفع → ${next}`);
                        setActionsOpen(false);
                      }
                    }} />
                    <hr className="my-1 border-gray-100" />
                  </>
                )}
                <ActionItem icon={CheckCircle2} label="تعليم النتيجة جاهزة" onClick={() => {
                  setOrderStatus(order.id, "result_ready", ref);
                  record(role, "order_update", "order", order.id, "تعليم النتيجة جاهزة");
                  setActionsOpen(false);
                }} />
                <ActionItem icon={Send} label="تعليم مكتمل" onClick={() => {
                  setOrderStatus(order.id, "completed", ref);
                  record(role, "order_update", "order", order.id, "تعليم مكتمل");
                  setActionsOpen(false);
                }} />
                {!isLab && (
                  <>
                    <hr className="my-1 border-gray-100" />
                    <ActionItem icon={Download} label="عرض/تنزيل الفاتورة" onClick={() => { window.print(); setActionsOpen(false); }} />
                    <ActionItem icon={X} label="إلغاء الطلب" danger onClick={async () => {
                      const reason = window.prompt("سبب الإلغاء:", "");
                      if (reason !== null) {
                        const r = await cancelOrder(order.id, ref, reason || undefined);
                        if (!r.ok) toast.error(r.error ?? "تعذر إلغاء الطلب");
                        else record(role, "order_update", "order", order.id, `إلغاء الطلب${reason ? ` — ${reason}` : ""}`);
                        setActionsOpen(false);
                      }
                    }} />
                  </>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

// Phase 3.6 — admin/lab/nurse-side rating card. Reads `order_ratings`
// directly via the admin endpoint added below. Renders nothing while
// loading or when no rating has been submitted yet.
function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-500" aria-label={`${n} من 5`}>
      {"★".repeat(n)}{"☆".repeat(5 - n)}
    </span>
  );
}
function RatingCard({ orderId }: { orderId: string }) {
  type RatingRow = {
    overall_rating: number;
    nurse_rating: number | null;
    lab_rating: number | null;
    comment: string | null;
    created_at: string;
  };
  const [row, setRow] = useState<RatingRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/rating`, { cache: "no-store" });
        if (!res.ok || cancelled) { setLoaded(true); return; }
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        setRow((body?.rating ?? null) as RatingRow | null);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [orderId]);
  if (!loaded) return null;
  if (!row) return null;
  return (
    <section className="bg-amber-50 border border-amber-100 rounded-xl p-4">
      <p className="text-[11px] text-amber-900 font-semibold uppercase tracking-wide mb-2">تقييم العميل</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-[#164E63]">
        <div><p className="text-[11px] text-gray-500 mb-0.5">عام</p><Stars n={row.overall_rating} /></div>
        {row.nurse_rating != null && (
          <div><p className="text-[11px] text-gray-500 mb-0.5">الممرض</p><Stars n={row.nurse_rating} /></div>
        )}
        {row.lab_rating != null && (
          <div><p className="text-[11px] text-gray-500 mb-0.5">المخبر</p><Stars n={row.lab_rating} /></div>
        )}
      </div>
      {row.comment && (
        <p className="text-xs text-amber-900/80 mt-2 leading-relaxed">&ldquo;{row.comment}&rdquo;</p>
      )}
    </section>
  );
}

function ActionItem({ icon: Icon, label, onClick, danger }: {
  icon: React.FC<{ size?: number; className?: string }>; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer text-start ${
        danger ? "text-red-600 hover:bg-red-50" : "text-[#164E63] hover:bg-gray-50"
      }`}
    >
      <Icon size={14} className={danger ? "text-red-500" : "text-gray-400"} />
      {label}
    </button>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────
// Order-first layout: Patient + Address + Booking + Payment lead. The Customer
// card is a compact secondary block at the bottom with a CTA that pushes to
// the user profile inline, so the admin doesn't lose order context.
function OverviewTab({ order, onOpenUser }: { order: Order; onOpenUser?: (userId: string) => void }) {
  const allOrders = useOrders();
  const previousOrdersCount = allOrders.filter((o) => o.userId === order.userId && o.id !== order.id).length;
  const showRating = order.status === "completed";

  return (
    <div className="space-y-3">
      {showRating && <RatingCard orderId={order.id} />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card title="المريض" icon={<User size={14} aria-hidden="true" />}>
          <Row label="الاسم المُدخل" value={order.patient.name} />
          <Row label="التحقق من الهوية" value={
            order.patientVerification ? (
              <span className="text-emerald-600">تم: {order.patientVerification.officialName}</span>
            ) : <span className="text-gray-400">لم يتم بعد</span>
          } />
        </Card>

        <Card title="العنوان" icon={<MapPin size={14} aria-hidden="true" />}>
          <Row label="العنوان" value={`${order.address.label} – ${order.address.description}`} />
          <Row label="الإحداثيات" value={<span className="lat" dir="ltr">{order.address.lat.toFixed(4)}, {order.address.lng.toFixed(4)}</span>} />
          <a
            href={`https://www.google.com/maps?q=${order.address.lat},${order.address.lng}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0891B2] mt-1"
          >
            فتح في الخرائط
          </a>
        </Card>

        <Card title="الموعد" icon={<Calendar size={14} aria-hidden="true" />}>
          <Row label="التاريخ" value={formatDate(order.visitDate)} />
          <Row label="الفترة" value={getShiftLabel(order.shift)} />
          <Row
            label="مختصر"
            value={
              <span className="font-semibold">
                {WEEKDAYS_AR[new Date(order.visitDate + "T00:00:00").getDay()]}
                {" - "}
                {order.shift === "morning" ? "صباحي" : "مسائي"}
                {order.shiftStartTime && order.shiftEndTime && (
                  <span className="lat" dir="ltr"> ({order.shiftStartTime} – {order.shiftEndTime})</span>
                )}
              </span>
            }
          />
        </Card>

        <Card title="الدفع" icon={<CreditCard size={14} aria-hidden="true" />}>
          <Row label="الطريقة" value={order.paymentMethod === "cash" ? "نقداً" : "إلكتروني"} />
          <Row label="الحالة" value={order.paymentStatus} />
          <Row label="الكوبون" value={order.couponCode ? `${order.couponCode} (-${formatPrice(order.couponDiscount)})` : "—"} />
        </Card>
      </div>

      {/* Compact customer card — secondary, with CTA to push to user profile */}
      <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
          <h4 className="text-xs font-bold text-[#164E63] flex items-center gap-1.5">
            <User size={14} aria-hidden="true" />
            العميل
          </h4>
        </header>
        <div className="p-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#164E63]">{order.patient.name}</p>
            <p className="text-[11px] text-gray-500 mt-0.5 lat" dir="ltr">+963 911 000 000</p>
            <p className="text-[11px] text-gray-400 mt-1">
              {previousOrdersCount === 0 ? "لا توجد طلبات سابقة" : `${previousOrdersCount} طلب سابق`}
            </p>
          </div>
          {onOpenUser && (
            <button
              onClick={() => onOpenUser(order.userId)}
              className="text-xs px-3 py-2 rounded-lg bg-[#ECFEFF] text-[#0891B2] font-semibold cursor-pointer active:bg-cyan-100"
            >
              عرض تفاصيل العميل
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Tab: Items ───────────────────────────────────────────────────────────────
function ItemsTab({ order }: { order: Order }) {
  const pkg = order.packageSnapshot;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">نستخدم بيانات لحظة الطلب — لا يتم تحديث الأسعار تلقائياً بعد الإنشاء.</p>
      {/* Phase 3.6 — admin viewer for the customer's uploaded prescription. */}
      {order.prescriptionUrl && (
        <div className="bg-white rounded-xl border border-gray-100 p-3">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">الوصفة المرفوعة من العميل</p>
          <a
            href={order.prescriptionUrl}
            target="_blank"
            rel="noreferrer"
            className="block relative w-full h-44 bg-gray-50 rounded-lg overflow-hidden cursor-pointer"
          >
            <Image src={order.prescriptionUrl} alt="الوصفة" fill sizes="(max-width: 768px) 100vw, 480px" className="object-contain" />
          </a>
          <p className="text-[11px] text-gray-400 mt-2 text-center">اضغط لفتح الصورة الكاملة (رابط موقّت من Supabase Storage).</p>
        </div>
      )}
      {pkg ? (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {/* Parent — package card */}
          <div className="flex items-center gap-3 p-4 border-b border-gray-50">
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 relative">
              <Image src={pkg.image} alt="" fill sizes="64px" className="object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">باقة</p>
              <p className="text-sm font-bold text-[#164E63]">{pkg.nameAr}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{pkg.testsCount} تحاليل · سعر الباقة</p>
            </div>
            <p className="text-sm font-bold text-[#164E63]">{formatPrice(pkg.price)}</p>
          </div>
          {/* Children — included tests for operations */}
          <div className="px-4 py-3 bg-gray-50/40">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">العناصر المضمّنة (للعمليات)</p>
            <ul className="space-y-1.5">
              {order.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#164E63] truncate">{it.nameAr}</p>
                    <p className="text-[11px] text-gray-400 lat" dir="ltr">{it.nameEn}</p>
                  </div>
                  <p className="text-[11px] text-gray-400">{formatPrice(it.priceSnapshot)}</p>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-gray-400 mt-2">العميل يرى الباقة كعنصر واحد فقط في السلة وتفاصيل الطلب.</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {order.items.map((it, i) => (
            <div key={it.id} className={`flex items-center justify-between px-4 py-3 ${i < order.items.length - 1 ? "border-b border-gray-50" : ""}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#164E63] truncate">{it.nameAr}</p>
                <p className="text-[11px] text-gray-400 lat" dir="ltr">{it.nameEn}</p>
              </div>
              <p className="text-sm font-bold text-[#164E63]">{formatPrice(it.priceSnapshot)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Operations ──────────────────────────────────────────────────────────
function OperationsTab({ order, role, nurses, labs, ref }: {
  order: Order; role: ControlCenterRole; nurses: Nurse[]; labs: Lab[]; ref: { actor: OrderEvent["actor"]; actorName?: string };
}) {
  const toast = useToast();
  const isLab = role.role === "lab_user";
  const nurse = nurses.find((n) => n.id === order.nurseId);
  const lab = labs.find((l) => l.id === order.labId);
  const allFiles = order.resultFiles ?? [];
  const activeFiles = allFiles.filter((f) => f.isActive);
  const archivedFiles = allFiles.filter((f) => !f.isActive);


  return (
    <div className="space-y-3">
      {/* Nurse */}
      <Card title="الممرض" icon={<UserCog size={14} aria-hidden="true" />}>
        <Row label="المعيّن" value={nurse?.name ?? "—"} />
        <Row label="حالة الزيارة" value={order.status} />
        {!isLab && (
          <div className="flex flex-wrap gap-2 pt-2">
            <select
              value={order.nurseId ?? ""}
              onChange={async (e) => {
                if (!e.target.value) return;
                const r = await assignNurse(order.id, e.target.value, ref);
                if (!r.ok) toast.error(r.error ?? "تعذر تعيين الممرض");
              }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
              aria-label="إسناد ممرض"
            >
              <option value="">— غير معيّن —</option>
              {nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
        )}
      </Card>

      {/* Lab */}
      <Card title="المخبر" icon={<Building2 size={14} aria-hidden="true" />}>
        <Row label="المعيّن" value={lab?.nameAr ?? lab?.name ?? "—"} />
        <Row label="مدة المعالجة المتوقعة" value={lab?.avgProcessingHours ? `${lab.avgProcessingHours} ساعات` : "—"} />
        {!isLab && (
          <div className="flex flex-wrap gap-2 pt-2">
            <select
              value={order.labId ?? ""}
              onChange={async (e) => {
                if (!e.target.value) return;
                const r = await assignLab(order.id, e.target.value, ref);
                if (!r.ok) toast.error(r.error ?? "تعذر تعيين المخبر");
              }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
              aria-label="إسناد مخبر"
            >
              <option value="">— غير معيّن —</option>
              {labs.map((l) => <option key={l.id} value={l.id}>{l.nameAr ?? l.name}</option>)}
            </select>
          </div>
        )}
      </Card>

      {/* Result files */}
      <Card title="ملفات النتائج" icon={<FileText size={14} aria-hidden="true" />} action={
        <button
          onClick={() => {
            const name = window.prompt("اسم الملف:", `${order.id}-result.pdf`);
            if (name) {
              uploadResultFile(order.id, {
                labId: order.labId ?? "lab-1",
                fileUrl: `/results/${order.id}/${name}`,
                fileName: name,
                uploadedBy: ref.actorName ?? "—",
              });
            }
          }}
          className="text-xs px-2.5 py-1 rounded-md bg-[#ECFEFF] text-[#0891B2] cursor-pointer flex items-center gap-1"
        >
          <Upload size={12} aria-hidden="true" /> رفع PDF
        </button>
      }>
        {activeFiles.length === 0 && archivedFiles.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">لم يُرفع أي ملف بعد</p>
        ) : (
          <ul className="space-y-2">
            {activeFiles.map((f) => (
              <li key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2.5">
                <FileText size={15} className="text-red-500" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#164E63] truncate">{f.fileName}</p>
                  <p className="text-[10px] text-gray-500">{f.uploadedBy} · {formatDate(f.uploadedAt)}</p>
                </div>
                <button
                  onClick={() => archiveResultFile(order.id, f.id, { actor: role.role === "lab_user" ? "lab" : "admin", actorName: ref.actorName ?? "—" })}
                  aria-label="أرشفة"
                  title="أرشفة (لا يُحذف نهائياً)"
                  className="w-7 h-7 rounded-md hover:bg-amber-50 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 size={12} className="text-red-400" aria-hidden="true" />
                </button>
              </li>
            ))}
            {archivedFiles.length > 0 && (
              <li className="pt-2">
                <p className="text-[10px] text-gray-400 mb-1">مؤرشف (يبقى للمراجعة، لا يظهر للعميل)</p>
                <ul className="space-y-1.5">
                  {archivedFiles.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2.5 opacity-50">
                      <FileText size={15} className="text-gray-400" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-500 truncate line-through">{f.fileName}</p>
                        <p className="text-[10px] text-gray-400">أُرشفت {f.archivedAt ? formatDate(f.archivedAt) : "—"} {f.archivedBy ? `· ${f.archivedBy}` : ""}</p>
                      </div>
                      <button
                        onClick={() => restoreResultFile(order.id, f.id, { actor: role.role === "lab_user" ? "lab" : "admin", actorName: ref.actorName ?? "—" })}
                        className="text-[10px] px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 cursor-pointer"
                      >
                        استعادة
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        )}

        {/* Confirm + auto-complete */}
        {!isLab && order.status !== "completed" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm" variant="primary"
              disabled={activeFiles.length === 0}
              onClick={async () => {
                const r = await confirmResultsReady(order.id, ref);
                if (!r.ok) toast.error(r.error ?? "تعذر تأكيد إرسال النتائج");
                else toast.success("اكتمل الطلب");
              }}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              تأكيد إرسال النتائج (إكمال الطلب)
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={async () => {
                const reason = window.prompt("سبب الإغلاق دون نتائج (مطلوب):", "");
                if (reason && reason.trim()) {
                  const r = await forceCompleteOrder(order.id, ref, reason.trim());
                  if (!r.ok) toast.error(r.error ?? "تعذر إغلاق الطلب");
                }
              }}
            >
              إغلاق دون نتائج
            </Button>
          </div>
        )}
      </Card>

      {/* File activity log */}
      {(order.fileEvents?.length ?? 0) > 0 && (
        <Card title="سجل ملفات الطلب" icon={<FileText size={14} aria-hidden="true" />}>
          <ol className="space-y-2">
            {[...(order.fileEvents ?? [])].reverse().map((ev) => (
              <li key={ev.id} className="text-[11px] text-[#164E63]">
                <span className="font-semibold">
                  {ev.type === "uploaded" ? "رفع" :
                   ev.type === "replaced" ? "استبدال" :
                   ev.type === "restored" ? "استعادة" :
                                            "أرشفة"}
                </span>
                {" — "}<span className="text-gray-500">{ev.fileName}</span>
                <span className="text-gray-400"> · {ev.actorName} · {formatDate(ev.createdAt)}</span>
                {ev.note && <p className="text-[11px] text-gray-400 mt-0.5">{ev.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Timeline ────────────────────────────────────────────────────────────
const EVENT_LABELS: Partial<Record<OrderEventType, string>> = {
  created: "تم إنشاء الطلب",
  scheduled: "تمت الجدولة",
  confirmed: "تم تأكيد الطلب",
  nurse_assigned: "تم تعيين الممرض",
  on_the_way: "الممرض في الطريق",
  arrived: "وصل الممرض",
  sample_collected: "تم أخذ العينة",
  sent_to_lab: "أُرسلت للمخبر",
  lab_processing: "يعالجها المخبر",
  result_uploaded: "تم رفع النتيجة",
  result_ready: "النتيجة جاهزة",
  result_sent: "تم إرسال النتيجة",
  completed: "اكتمل الطلب",
  failed_collection: "تعذّر أخذ العينة",
  lab_issue_opened: "تم فتح مشكلة في المخبر",
  lab_issue_resolved: "تم حل مشكلة المخبر",
  rescheduled: "تم إعادة الجدولة",
  cancelled: "تم إلغاء الطلب",
  payment_status_changed: "تغيّرت حالة الدفع",
  coupon_applied: "تم تطبيق كوبون",
  note_added: "تمت إضافة ملاحظة",
};

function TimelineTab({ order }: { order: Order }) {
  const events = order.events ?? [];
  if (events.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">لا توجد أحداث بعد</p>;
  }
  return (
    <ol className="relative ms-3">
      <div className="absolute top-2 bottom-2 w-px bg-gray-200" aria-hidden="true" />
      {events.map((e) => (
        <li key={e.id} className="relative ps-5 pb-4">
          <div className="absolute start-[-5px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#0891B2] ring-4 ring-white" aria-hidden="true" />
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#164E63]">{EVENT_LABELS[e.type] ?? e.type}</p>
            <span className="text-[11px] text-gray-400">{relativeTime(e.createdAt)}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {e.actor} {e.actorName ? `· ${e.actorName}` : ""}
            {e.note ? ` — ${e.note}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ─── Tab: Issues ──────────────────────────────────────────────────────────────
function IssuesTab({ order, role, ref }: {
  order: Order; role: ControlCenterRole; ref: { actor: OrderEvent["actor"]; actorName?: string };
}) {
  const [labType, setLabType] = useState<LabIssueType>("invalid_sample");
  const [labDesc, setLabDesc] = useState("");
  const [failedReason, setFailedReason] = useState(order.failedReason ?? "");

  const issues = order.issues ?? [];

  return (
    <div className="space-y-4">
      {/* Failed collection (admin/nurse-side info) */}
      {role.role !== "lab_user" && (
        <Card title="فشل في أخذ العينة" icon={<AlertTriangle size={14} aria-hidden="true" />}>
          <select
            value={failedReason}
            onChange={(e) => setFailedReason(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
            aria-label="سبب الفشل"
          >
            <option value="">— لا يوجد —</option>
            {FAILED_COLLECTION_REASONS.map((r) => <option key={r.value} value={r.value}>{r.labelAr}</option>)}
          </select>
          {failedReason && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => {
              setOrderStatus(order.id, "failed_to_collect", ref, failedReason);
            }}>
              تعليم تعذّر الأخذ
            </Button>
          )}
        </Card>
      )}

      {/* Open lab issue */}
      <Card title="فتح مشكلة في المخبر" icon={<AlertTriangle size={14} aria-hidden="true" />}>
        <div className="space-y-2">
          <select
            value={labType}
            onChange={(e) => setLabType(e.target.value as LabIssueType)}
            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
            aria-label="نوع المشكلة"
          >
            {LAB_ISSUE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.labelAr}</option>)}
          </select>
          <textarea
            value={labDesc}
            onChange={(e) => setLabDesc(e.target.value)}
            rows={2}
            placeholder="وصف المشكلة"
            className="w-full p-2.5 rounded-lg border border-gray-200 text-xs resize-none focus:border-[#0891B2] outline-none"
          />
          <Button size="sm" variant="primary" disabled={!labDesc.trim()} onClick={() => {
            openLabIssue({
              orderId: order.id,
              labId: order.labId ?? "lab-1",
              type: labType,
              description: labDesc.trim(),
              createdBy: ref.actorName ?? "—",
              createdByRole: role.role === "lab_user" ? "lab" : "admin",
            });
            setLabDesc("");
          }}>
            <Plus size={13} aria-hidden="true" />
            فتح المشكلة
          </Button>
        </div>
      </Card>

      {/* Existing issues */}
      <Card title={`المشاكل المسجّلة (${issues.length})`} icon={<AlertTriangle size={14} aria-hidden="true" />}>
        {issues.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">لا توجد مشاكل</p>
        ) : (
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-bold text-[#164E63]">{LAB_ISSUE_REASONS.find((r) => r.value === i.type)?.labelAr ?? i.type}</p>
                  <Pill color={i.status === "resolved" ? "green" : "amber"}>{i.status === "resolved" ? "محلولة" : "مفتوحة"}</Pill>
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{i.description}</p>
                {i.status !== "resolved" && role.role !== "lab_user" && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => {
                    const note = window.prompt("ملاحظة الحل:", "");
                    if (note !== null) resolveLabIssue(i.id, note, ref);
                  }}>
                    <RotateCcw size={12} aria-hidden="true" />
                    حل المشكلة
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Tab: Finance ─────────────────────────────────────────────────────────────
function FinanceTab({ order, role, ref }: {
  order: Order; role: ControlCenterRole; ref: { actor: OrderEvent["actor"]; actorName?: string };
}) {
  const toast = useToast();
  const editable = canEditPricing(role.role);
  return (
    <div className="space-y-3">
      <Card title="الملخص المالي" icon={<DollarSign size={14} aria-hidden="true" />}>
        <Row label="المجموع الفرعي" value={formatPrice(order.subtotal)} />
        <Row label="خصم الكوبون" value={order.couponDiscount > 0 ? `-${formatPrice(order.couponDiscount)} (${order.couponCode})` : "—"} />
        <Row label="الإجمالي" value={<span className="font-bold">{formatPrice(order.total)}</span>} />
        <Row label="طريقة الدفع" value={order.paymentMethod === "cash" ? "نقداً" : "إلكتروني"} />
        <Row label="حالة الدفع" value={order.paymentStatus} />
      </Card>

      {editable && (
        <Card title="إجراءات" icon={<Pencil size={14} aria-hidden="true" />}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={async () => {
              const r = await setPaymentStatus(order.id, "paid", ref);
              if (!r.ok) toast.error(r.error ?? "تعذر تأكيد الدفع");
            }}>تأكيد الدفع</Button>
            <Button size="sm" variant="outline" onClick={async () => {
              const r = await setPaymentStatus(order.id, "pending", ref);
              if (!r.ok) toast.error(r.error ?? "تعذر تعليق الدفع");
            }}>تعليق الدفع</Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Download size={13} aria-hidden="true" /> الفاتورة
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Notes ───────────────────────────────────────────────────────────────
function NotesTab({ order, role }: { order: Order; role: ControlCenterRole }) {
  const [text, setText] = useState("");
  const sortedNotes = useMemo(() => {
    const notes = order.notes ?? [];
    return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [order.notes]);

  const submit = () => {
    if (!text.trim()) return;
    addNote(order.id, {
      authorId: "—",
      authorName: role.actorName,
      authorRole: role.role === "lab_user" ? "lab" : "admin",
      text: text.trim(),
    });
    setText("");
  };

  return (
    <div className="space-y-3">
      <Card title="إضافة ملاحظة داخلية" icon={<StickyNote size={14} aria-hidden="true" />}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="ملاحظة لا يراها العميل…"
          className="w-full p-2.5 rounded-lg border border-gray-200 text-xs resize-none focus:border-[#0891B2] outline-none"
        />
        <Button size="sm" variant="primary" className="mt-2" disabled={!text.trim()} onClick={submit}>
          <Plus size={13} aria-hidden="true" />
          إضافة
        </Button>
      </Card>

      {sortedNotes.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">لا توجد ملاحظات</p>
      ) : (
        <ul className="space-y-2">
          {sortedNotes.map((n: OrderNote) => (
            <li key={n.id} className="bg-white rounded-xl border border-gray-100 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-[#164E63]">{n.authorName} · {n.authorRole}</p>
                <span className="text-[11px] text-gray-400">{relativeTime(n.createdAt)}</span>
              </div>
              <p className="text-xs text-[#164E63] mt-1 leading-relaxed">{n.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Local helpers ────────────────────────────────────────────────────────────
function Card({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
        <h4 className="text-xs font-bold text-[#164E63] flex items-center gap-1.5">
          {icon}
          {title}
        </h4>
        {action}
      </header>
      <div className="p-4 space-y-1.5">
        {children}
      </div>
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

function Pill({ children, color = "gray" }: { children: React.ReactNode; color?: "gray" | "green" | "red" | "amber" | "cyan" | "purple" }) {
  const map = {
    gray:   "bg-gray-100 text-gray-600",
    green:  "bg-emerald-50 text-emerald-700",
    red:    "bg-red-50 text-red-600",
    amber:  "bg-amber-50 text-amber-700",
    cyan:   "bg-cyan-50 text-cyan-700",
    purple: "bg-purple-50 text-purple-700",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[color]}`}>{children}</span>;
}
