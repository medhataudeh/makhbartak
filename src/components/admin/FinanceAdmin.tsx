"use client";
import { useEffect, useMemo, useState } from "react";
import { Banknote, Wallet, Receipt, ArrowUpRight, ArrowDownRight, Plus, Loader2, CheckCircle2, RotateCcw, BarChart3 } from "lucide-react";
import type { AdminRole } from "@/lib/types";
import { formatPrice, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { logActivity } from "@/lib/activity-log";

interface Props {
  adminId: string;
  adminName: string;
  adminRole: AdminRole;
}

interface Overview {
  currency: "SYP";
  totalRevenue: number;
  totalCollected: number;
  totalRefunded: number;
  totalCommission: number;
  totalSettlements: number;
  totalAdjustments: number;
  pendingCashWithNurses: number;
  netProfit: number;
}

interface NurseWallet {
  nurseId: string;
  nurseName: string;
  totalCollected: number;
  totalCommission: number;
  totalSettled: number;
  totalAdjustments: number;
  netDue: number;
  currency: "SYP";
}

type PaymentStatus =
  | "pending" | "paid" | "paid_by_nurse" | "verified_by_admin"
  | "partially_refunded" | "refunded" | "failed";

interface PaymentRow {
  id: string;
  orderId: string;
  orderPublicNumber: string | null;
  orderTotal: number;
  method: "cash" | "online";
  status: PaymentStatus;
  amount: number;
  currency: string;
  // Phase 4.3 provider columns:
  provider: string | null;
  providerRef: string | null;
  chargedAmount: number | null;
  providerCurrency: string | null;
  exchangeRate: number | null;
  paidAt: string | null;
  collectedAt: string | null;
  collectedByNurseId: string | null;
  collectedByNurseName: string | null;
  verifiedByAdminId: string | null;
  verifiedAt: string | null;
  refundedAmount: number;
  refundedAt: string | null;
  refundReason: string | null;
  createdAt: string;
}

interface SettlementRow {
  id: string;
  nurseId: string;
  nurseName: string;
  type: "settlement_paid" | "adjustment";
  amount: number;
  currency: string;
  descriptionAr: string;
  createdAt: string;
}

interface ReportPayload {
  currency: string;
  grossRevenue: number;
  netRevenue: number;
  totalRefunded: number;
  perDay:    { date: string; revenue: number; refunded: number; count: number }[];
  perNurse:  { nurseId: string; nurseName: string; revenue: number; refunded: number; count: number }[];
  perStatus: { status: string; revenue: number; count: number }[];
  rowCount:  number;
}

const STATUS_LABELS_AR: Record<PaymentStatus, string> = {
  pending:            "بانتظار الدفع",
  paid:               "مدفوع",
  paid_by_nurse:      "مُحصَّل عبر الممرض",
  verified_by_admin:  "مُحقَّق إدارياً",
  partially_refunded: "مسترد جزئياً",
  refunded:           "مُسترد",
  failed:             "فشل",
};

const METHOD_LABELS_AR: Record<PaymentRow["method"], string> = {
  cash:   "نقداً",
  online: "إلكتروني",
};

export function FinanceAdmin({ adminId, adminName, adminRole }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<"overview" | "nurses" | "payments" | "settlements" | "reports">("overview");

  const [overview, setOverview] = useState<Overview | null>(null);
  const [wallets, setWallets] = useState<NurseWallet[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<NurseWallet | null>(null);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const fetchAll = async (signal?: AbortSignal) => {
    const [oRes, wRes, pRes, sRes] = await Promise.all([
      fetch("/api/admin/finance/overview",       { cache: "no-store", signal }),
      fetch("/api/admin/finance/nurse-wallets",  { cache: "no-store", signal }),
      fetch("/api/admin/payments",               { cache: "no-store", signal }),
      fetch("/api/admin/finance/settlements",    { cache: "no-store", signal }),
    ]);
    return {
      overview:    oRes.ok ? ((await oRes.json()).overview as Overview | null) : null,
      wallets:     wRes.ok ? ((await wRes.json()).wallets as NurseWallet[] | undefined) ?? [] : [],
      payments:    pRes.ok ? ((await pRes.json()).payments as PaymentRow[] | undefined) ?? [] : [],
      settlements: sRes.ok ? ((await sRes.json()).settlements as SettlementRow[] | undefined) ?? [] : [],
    };
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await fetchAll();
      setOverview(data.overview);
      setWallets(data.wallets);
      setPayments(data.payments);
      setSettlements(data.settlements);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const data = await fetchAll(ctrl.signal);
        if (ctrl.signal.aborted) return;
        setOverview(data.overview);
        setWallets(data.wallets);
        setPayments(data.payments);
        setSettlements(data.settlements);
      } catch { /* aborted */ }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    })();
    return () => ctrl.abort();
  }, []);

  const verifyPayment = async (p: PaymentRow) => {
    if (verifyingId) return;
    setVerifyingId(p.id);
    try {
      const res = await fetch(`/api/admin/payments/${encodeURIComponent(p.id)}/verify`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? "تعذر التحقق من الدفعة");
        return;
      }
      toast.success("تم التحقق من الدفعة");
      logActivity({
        adminId, adminName, role: adminRole,
        action: "invoice_status", entity: "payment", entityId: p.id,
        details: `تحقق من الدفعة ${p.orderPublicNumber ?? p.id}`,
      });
      await refresh();
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-[#164E63]">المالية</h2>
          <p className="text-xs text-gray-500 mt-0.5">عرض شامل للتدفق النقدي، عمولات الممرضين، والتسويات. كل مبلغ مرتبط بسجل قابل للتدقيق.</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : null} تحديث
        </Button>
      </div>

      <div className="flex gap-1 px-1 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {([
          { v: "overview" as const,    label: "نظرة عامة" },
          { v: "nurses" as const,      label: "محافظ الممرضين" },
          { v: "payments" as const,    label: "المدفوعات" },
          { v: "settlements" as const, label: "التسويات" },
          { v: "reports" as const,     label: "التقارير" },
        ]).map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            aria-current={tab === t.v ? "page" : undefined}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              tab === t.v ? "border-[#0891B2] text-[#0891B2]" : "border-transparent text-gray-500 hover:text-[#164E63]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewPane overview={overview} loading={loading} />}
      {tab === "nurses" && <NursesPane wallets={wallets} loading={loading} onPay={setCreating} />}
      {tab === "payments" && (
        <PaymentsPane
          rows={payments}
          loading={loading}
          verifyingId={verifyingId}
          onVerify={verifyPayment}
          onRefund={setRefunding}
        />
      )}
      {tab === "settlements" && <SettlementsPane rows={settlements} loading={loading} />}
      {tab === "reports" && <ReportsPane />}

      {creating && (
        <SettleModal
          wallet={creating}
          onClose={() => setCreating(null)}
          onSubmitted={async (amount, note) => {
            try {
              const res = await fetch("/api/admin/finance/settlements", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ nurseId: creating.nurseId, amount, note }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                toast.error((body as { error?: string }).error ?? "تعذر تسجيل التسوية");
                return false;
              }
              toast.success("تم تسجيل التسوية");
              logActivity({
                adminId, adminName, role: adminRole,
                action: "settings_change", entity: "settlement", entityId: creating.nurseId,
                details: `تسوية ${creating.nurseName}: ${formatPrice(amount)}`,
              });
              setCreating(null);
              await refresh();
              return true;
            } catch (err) {
              toast.error((err as Error).message);
              return false;
            }
          }}
        />
      )}

      {refunding && (
        <RefundModal
          payment={refunding}
          onClose={() => setRefunding(null)}
          onSubmitted={async (amount, reason) => {
            try {
              const res = await fetch(`/api/admin/payments/${encodeURIComponent(refunding.id)}/refund`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ amount, reason }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                toast.error((body as { error?: string }).error ?? "تعذر تسجيل الاسترجاع");
                return false;
              }
              toast.success("تم تسجيل الاسترجاع");
              logActivity({
                adminId, adminName, role: adminRole,
                action: "invoice_status", entity: "payment", entityId: refunding.id,
                details: `استرجاع ${refunding.orderPublicNumber ?? refunding.id}: ${formatPrice(amount)} — ${reason}`,
              });
              setRefunding(null);
              await refresh();
              return true;
            } catch (err) {
              toast.error((err as Error).message);
              return false;
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Panes ──────────────────────────────────────────────────────────────────

function OverviewPane({ overview, loading }: { overview: Overview | null; loading: boolean }) {
  if (loading && !overview) return <SkeletonGrid />;
  if (!overview) return <p className="text-sm text-gray-400 text-center py-10">لا توجد بيانات مالية</p>;
  const { totalRevenue, totalCollected, totalRefunded, totalCommission, totalSettlements, pendingCashWithNurses, netProfit } = overview;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <Card icon={<Receipt size={18} className="text-[#0891B2]" />} label="إجمالي الإيرادات" value={formatPrice(totalRevenue)} sub="الطلبات غير الملغاة وغير المُستردة" />
      <Card icon={<Banknote size={18} className="text-emerald-600" />} label="إجمالي المقبوضات" value={formatPrice(totalCollected)} sub="صافي بعد الاسترجاعات" />
      <Card icon={<ArrowUpRight size={18} className="text-amber-600" />} label="الرصيد عند الممرضين" value={formatPrice(pendingCashWithNurses)} sub="رصيد المحافظ الإجمالي" />
      <Card icon={<ArrowDownRight size={18} className="text-purple-600" />} label="إجمالي العمولات" value={formatPrice(totalCommission)} />
      <Card icon={<Wallet size={18} className="text-cyan-700" />} label="إجمالي التسويات" value={formatPrice(totalSettlements)} />
      <Card icon={<RotateCcw size={18} className="text-rose-600" />} label="إجمالي الاسترجاعات" value={formatPrice(totalRefunded)} />
      <Card icon={<BarChart3 size={18} className="text-emerald-700" />} label="صافي الربح" value={formatPrice(netProfit)} sub="العمولات − الاسترجاعات" />
    </div>
  );
}

function NursesPane({ wallets, loading, onPay }: { wallets: NurseWallet[]; loading: boolean; onPay: (w: NurseWallet) => void }) {
  if (loading && wallets.length === 0) return <SkeletonGrid />;
  if (wallets.length === 0) return <p className="text-sm text-gray-400 text-center py-10">لا توجد بيانات مالية</p>;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
            <th className="text-start py-2 px-3 font-semibold">الممرض</th>
            <th className="text-start py-2 px-3 font-semibold">المقبوضات</th>
            <th className="text-start py-2 px-3 font-semibold">العمولات</th>
            <th className="text-start py-2 px-3 font-semibold">التسويات</th>
            <th className="text-start py-2 px-3 font-semibold">الصافي المستحق</th>
            <th className="text-end py-2 px-3 font-semibold">إجراء</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <tr key={w.nurseId} className="border-b border-gray-50 last:border-0">
              <td className="py-2 px-3 font-semibold text-[#164E63]">{w.nurseName}</td>
              <td className="py-2 px-3 text-emerald-700">{formatPrice(w.totalCollected)}</td>
              <td className="py-2 px-3 text-purple-700">{formatPrice(w.totalCommission)}</td>
              <td className="py-2 px-3 text-cyan-700">{formatPrice(w.totalSettled)}</td>
              <td className="py-2 px-3 font-bold">{formatPrice(w.netDue)}</td>
              <td className="py-2 px-3 text-end">
                <Button size="sm" variant="primary" disabled={w.netDue <= 0} onClick={() => onPay(w)}>
                  <Plus size={12} aria-hidden="true" /> تسوية
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsPane({ rows, loading, verifyingId, onVerify, onRefund }: {
  rows: PaymentRow[]; loading: boolean; verifyingId: string | null;
  onVerify: (p: PaymentRow) => Promise<void>; onRefund: (p: PaymentRow) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [methodFilter, setMethodFilter] = useState<"all" | PaymentRow["method"]>("all");
  const filtered = useMemo(() =>
    rows.filter((r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (methodFilter === "all" || r.method === methodFilter),
    ),
  [rows, statusFilter, methodFilter]);

  if (loading && rows.length === 0) return <SkeletonGrid />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
        >
          <option value="all">كل الحالات</option>
          {(Object.keys(STATUS_LABELS_AR) as PaymentStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS_AR[s]}</option>
          ))}
        </select>
        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value as typeof methodFilter)}
          className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
        >
          <option value="all">كل طرق الدفع</option>
          <option value="cash">نقداً</option>
          <option value="online">إلكتروني</option>
        </select>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="text-start py-2 px-3 font-semibold">الطلب</th>
              <th className="text-start py-2 px-3 font-semibold">المبلغ</th>
              <th className="text-start py-2 px-3 font-semibold">الطريقة</th>
              <th className="text-start py-2 px-3 font-semibold">المزود</th>
              <th className="text-start py-2 px-3 font-semibold">الحالة</th>
              <th className="text-start py-2 px-3 font-semibold">الممرض</th>
              <th className="text-start py-2 px-3 font-semibold">التاريخ</th>
              <th className="text-end py-2 px-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center text-gray-400 py-6 text-xs">لا توجد بيانات مالية</td></tr>
            )}
            {filtered.map((r) => {
              const remaining = Math.max(0, r.amount - r.refundedAmount);
              const isOnline = r.method === "online";
              const canVerify = !isOnline && (r.status === "paid_by_nurse" || r.status === "paid");
              const canRefund = !isOnline && remaining > 0 && (r.status === "paid" || r.status === "paid_by_nurse" || r.status === "verified_by_admin" || r.status === "partially_refunded");
              return (
                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 px-3"><span className="lat" dir="ltr">{r.orderPublicNumber ?? "—"}</span></td>
                  <td className="py-2 px-3 font-semibold">
                    {formatPrice(r.amount)}
                    {r.refundedAmount > 0 && (
                      <span className="text-[11px] text-rose-600 ms-2">−{formatPrice(r.refundedAmount)}</span>
                    )}
                    {isOnline && r.chargedAmount !== null && r.providerCurrency && (
                      <div className="text-[11px] text-gray-400 mt-0.5 lat" dir="ltr">
                        {r.chargedAmount.toFixed(2)} {r.providerCurrency}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3">{METHOD_LABELS_AR[r.method]}</td>
                  <td className="py-2 px-3">
                    {r.provider ? (
                      <div className="text-xs">
                        <span className="font-semibold">{r.provider}</span>
                        {r.providerRef && (
                          <div className="text-[11px] text-gray-400 lat truncate max-w-[180px]" dir="ltr" title={r.providerRef}>
                            {r.providerRef}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">{STATUS_LABELS_AR[r.status] ?? r.status}</td>
                  <td className="py-2 px-3">{r.collectedByNurseName ?? "—"}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {r.collectedAt ? relativeTime(r.collectedAt) : r.paidAt ? relativeTime(r.paidAt) : relativeTime(r.createdAt)}
                  </td>
                  <td className="py-2 px-3 text-end">
                    <div
                      className="inline-flex gap-1.5"
                      title={isOnline ? "الدفع الإلكتروني يُحقَّق ويُسترد عبر مزود الدفع" : undefined}
                    >
                      <Button
                        size="sm" variant="outline"
                        disabled={!canVerify || verifyingId === r.id}
                        loading={verifyingId === r.id}
                        onClick={() => onVerify(r)}
                      >
                        <CheckCircle2 size={12} aria-hidden="true" /> تحقق
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        disabled={!canRefund}
                        onClick={() => onRefund(r)}
                      >
                        <RotateCcw size={12} aria-hidden="true" /> استرجاع
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettlementsPane({ rows, loading }: { rows: SettlementRow[]; loading: boolean }) {
  if (loading && rows.length === 0) return <SkeletonGrid />;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
            <th className="text-start py-2 px-3 font-semibold">الممرض</th>
            <th className="text-start py-2 px-3 font-semibold">المبلغ</th>
            <th className="text-start py-2 px-3 font-semibold">النوع</th>
            <th className="text-start py-2 px-3 font-semibold">الوصف</th>
            <th className="text-start py-2 px-3 font-semibold">التاريخ</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="text-center text-gray-400 py-6 text-xs">لا توجد بيانات مالية</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-50 last:border-0">
              <td className="py-2 px-3 font-semibold text-[#164E63]">{r.nurseName}</td>
              <td className="py-2 px-3 font-semibold">{formatPrice(r.amount)}</td>
              <td className="py-2 px-3 text-xs">{r.type === "settlement_paid" ? "تسوية" : "تعديل"}</td>
              <td className="py-2 px-3 text-xs text-gray-600">{r.descriptionAr}</td>
              <td className="py-2 px-3 text-xs text-gray-500">{relativeTime(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function defaultDateRange() {
  const now = Date.now();
  const today    = new Date(now).toISOString().slice(0, 10);
  const monthAgo = new Date(now - 30 * 86400_000).toISOString().slice(0, 10);
  return { today, monthAgo };
}

function ReportsPane() {
  const [{ today, monthAgo }] = useState(defaultDateRange);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to)   params.set("to", to);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/admin/finance/reports?${params.toString()}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
      else setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ from: monthAgo, to: today });
        const res = await fetch(`/api/admin/finance/reports?${params.toString()}`, { cache: "no-store", signal: ctrl.signal });
        if (!ctrl.signal.aborted && res.ok) setData(await res.json());
      } catch { /* aborted */ }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    })();
    return () => ctrl.abort();
  // monthAgo / today are stable strings recomputed on mount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          <span className="block mb-1">من</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-2 rounded-lg border border-gray-200 text-xs cursor-pointer" />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">إلى</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-2 rounded-lg border border-gray-200 text-xs cursor-pointer" />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">الحالة</span>
          <select
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
          >
            <option value="all">كل المُحصَّلات</option>
            {(["paid_by_nurse", "verified_by_admin", "partially_refunded", "refunded"] as const).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS_AR[s]}</option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="primary" onClick={load} disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : null} تشغيل التقرير
        </Button>
      </div>

      {!data ? (
        <p className="text-sm text-gray-400 text-center py-10">{loading ? "جاري التحميل…" : "لا توجد بيانات مالية"}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card icon={<Banknote size={18} className="text-emerald-600" />} label="الإيرادات (إجمالي)" value={formatPrice(data.grossRevenue)} />
            <Card icon={<BarChart3 size={18} className="text-emerald-700" />} label="الإيرادات (صافٍ)" value={formatPrice(data.netRevenue)} sub="بعد خصم الاسترجاعات" />
            <Card icon={<RotateCcw size={18} className="text-rose-600" />} label="إجمالي المُسترد" value={formatPrice(data.totalRefunded)} />
          </div>

          <Section title="الإيراد اليومي">
            {data.perDay.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">لا توجد بيانات مالية</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="text-start py-2 px-3 font-semibold">التاريخ</th>
                    <th className="text-start py-2 px-3 font-semibold">العدد</th>
                    <th className="text-start py-2 px-3 font-semibold">الإيراد الصافي</th>
                    <th className="text-start py-2 px-3 font-semibold">المسترد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perDay.map((d) => (
                    <tr key={d.date} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 px-3 lat" dir="ltr">{d.date}</td>
                      <td className="py-2 px-3">{d.count}</td>
                      <td className="py-2 px-3 font-semibold text-emerald-700">{formatPrice(d.revenue)}</td>
                      <td className="py-2 px-3 text-rose-600">{d.refunded > 0 ? formatPrice(d.refunded) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="الإيراد لكل ممرض">
            {data.perNurse.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">لا توجد بيانات مالية</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="text-start py-2 px-3 font-semibold">الممرض</th>
                    <th className="text-start py-2 px-3 font-semibold">العدد</th>
                    <th className="text-start py-2 px-3 font-semibold">الإيراد الصافي</th>
                    <th className="text-start py-2 px-3 font-semibold">المسترد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perNurse.map((n) => (
                    <tr key={n.nurseId} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 px-3">{n.nurseName}</td>
                      <td className="py-2 px-3">{n.count}</td>
                      <td className="py-2 px-3 font-semibold text-emerald-700">{formatPrice(n.revenue)}</td>
                      <td className="py-2 px-3 text-rose-600">{n.refunded > 0 ? formatPrice(n.refunded) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="الإيراد لكل حالة">
            {data.perStatus.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">لا توجد بيانات مالية</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="text-start py-2 px-3 font-semibold">الحالة</th>
                    <th className="text-start py-2 px-3 font-semibold">العدد</th>
                    <th className="text-start py-2 px-3 font-semibold">الإيراد الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perStatus.map((s) => (
                    <tr key={s.status} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 px-3">{STATUS_LABELS_AR[s.status as PaymentStatus] ?? s.status}</td>
                      <td className="py-2 px-3">{s.count}</td>
                      <td className="py-2 px-3 font-semibold">{formatPrice(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

// ─── Bits ───────────────────────────────────────────────────────────────────

function Card({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-500 font-medium truncate">{label}</p>
        <p className="text-base font-bold text-[#164E63] mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <header className="px-4 py-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-[#164E63]">{title}</h3>
      </header>
      {children}
    </section>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 rounded-2xl bg-gray-50 animate-pulse" />
      ))}
    </div>
  );
}

function SettleModal({ wallet, onClose, onSubmitted }: {
  wallet: NurseWallet;
  onClose: () => void;
  onSubmitted: (amount: number, note: string) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState(String(wallet.netDue || 0));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const numeric = Number(amount);
  const valid = Number.isFinite(numeric) && numeric > 0 && numeric <= wallet.netDue + 0.01;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-[#164E63]">تسجيل تسوية</h3>
          <p className="text-xs text-gray-500 mt-0.5">{wallet.nurseName} — المستحق صافٍ {formatPrice(wallet.netDue)}</p>
        </div>
        <label className="block">
          <span className="text-[11px] text-gray-500 font-medium">المبلغ (ل.س)</span>
          <input
            type="number" inputMode="decimal" min={0} value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm mt-1 outline-none focus:border-[#0891B2]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-500 font-medium">ملاحظة (اختياري)</span>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            className="w-full p-3 rounded-xl border border-gray-200 text-sm mt-1 outline-none focus:border-[#0891B2] resize-y"
            placeholder="مثال: تسوية أسبوعية"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>إلغاء</Button>
          <Button
            variant="primary" loading={submitting}
            disabled={!valid || submitting}
            onClick={async () => {
              setSubmitting(true);
              const ok = await onSubmitted(numeric, note.trim());
              if (!ok) setSubmitting(false);
            }}
          >
            حفظ التسوية
          </Button>
        </div>
      </div>
    </div>
  );
}

function RefundModal({ payment, onClose, onSubmitted }: {
  payment: PaymentRow;
  onClose: () => void;
  onSubmitted: (amount: number, reason: string) => Promise<boolean>;
}) {
  const remaining = Math.max(0, payment.amount - payment.refundedAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const numeric = Number(amount);
  const validAmount = Number.isFinite(numeric) && numeric > 0 && numeric <= remaining + 0.01;
  const validReason = reason.trim().length >= 3;
  const canSubmit = validAmount && validReason && confirmed && !submitting;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-[#164E63]">تسجيل استرجاع</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            الطلب <span className="lat" dir="ltr">{payment.orderPublicNumber ?? "—"}</span>
            {" "}— المتبقي للاسترجاع {formatPrice(remaining)}
          </p>
        </div>
        <label className="block">
          <span className="text-[11px] text-gray-500 font-medium">المبلغ (ل.س)</span>
          <input
            type="number" inputMode="decimal" min={0} max={remaining} value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm mt-1 outline-none focus:border-[#0891B2]"
          />
          <p className="text-[11px] text-gray-400 mt-1">يمكن استرجاع كامل المبلغ أو جزء منه.</p>
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-500 font-medium">السبب (مطلوب)</span>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className="w-full p-3 rounded-xl border border-gray-200 text-sm mt-1 outline-none focus:border-[#0891B2] resize-y"
            placeholder="اكتب سبب الاسترجاع"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[#164E63]">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="w-4 h-4" />
          أؤكد إعادة المبلغ للعميل وإجراء التعديل المالي
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>إلغاء</Button>
          <Button
            variant="danger" loading={submitting} disabled={!canSubmit}
            onClick={async () => {
              setSubmitting(true);
              const ok = await onSubmitted(numeric, reason.trim());
              if (!ok) setSubmitting(false);
            }}
          >
            تأكيد الاسترجاع
          </Button>
        </div>
      </div>
    </div>
  );
}
