"use client";
import { useEffect, useState } from "react";
import {
  ClipboardList, Package as PackageIcon, Settings as SettingsIcon, History,
  AlertTriangle, DollarSign, StickyNote, MapPin, User, Calendar, CreditCard,
} from "lucide-react";
import Image from "next/image";
import type {
  Order, Nurse, Lab, OrderEvent,
  AdminRole,
} from "@/lib/types";
import { formatDate, formatPrice, getShiftLabel } from "@/lib/utils";
import { useOrders } from "@/lib/store";
import { NotesTab } from "@/components/admin/OCCNotesTab";
import { TimelineTab } from "@/components/admin/OCCTimelineTab";
import { IssuesTab } from "@/components/admin/OCCIssuesTab";
import { OperationsTab } from "@/components/admin/OCCOperationsTab";
import { FinanceTab } from "@/components/admin/OCCFinanceTab";
import { StickyHeader } from "@/components/admin/OCCStickyHeader";

type Tab = "overview" | "items" | "operations" | "timeline" | "issues" | "finance" | "notes";

const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// U4.A: exported so the extracted OCCNotesTab can type its `role` prop.
// Type-only re-import in the child file (no runtime cycle).
export interface ControlCenterRole {
  /** Logical role driving permission checks. */
  role: AdminRole | "lab_user";
  /** Display name written into events/notes. */
  actorName: string;
  /** Lower-level actor type used for events. */
  actor: OrderEvent["actor"];
  /** Admin user id for activity-log entries. Optional for lab role. */
  adminId?: string;
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

// ─── Tab: Overview ────────────────────────────────────────────────────────────
// Order-first layout: Patient + Address + Booking + Payment lead. The Customer
// card is a compact secondary block at the bottom with a CTA that pushes to
// the user profile inline, so the admin doesn't lose order context.
function OverviewTab({ order, onOpenUser }: { order: Order; onOpenUser?: (userId: string) => void }) {
  const allOrders = useOrders();
  const previousOrdersCount = allOrders.filter((o) => o.userId === order.userId && o.id !== order.id).length;
  const showRating = order.status === "completed";
  // Phase 3.9 P1: real customer phone from /api/admin/customers/[id]. The
  // OCC mini-card previously printed a hard-coded +963 placeholder.
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/customers/${encodeURIComponent(order.userId)}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = await res.json().catch(() => null);
        const phone = body?.customer?.profile?.phone ?? null;
        if (!cancelled) setCustomerPhone(typeof phone === "string" ? phone : null);
      } catch { /* keep null */ }
    })();
    return () => { cancelled = true; };
  }, [order.userId]);

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
            {customerPhone ? (
              <p className="text-[11px] text-gray-500 mt-0.5 lat ltr-tech">{customerPhone}</p>
            ) : (
              <p className="text-[11px] text-gray-400 mt-0.5">لا يوجد رقم هاتف</p>
            )}
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
