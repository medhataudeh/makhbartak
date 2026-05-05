"use client";
import { useEffect, useMemo, useState } from "react";
import { Banknote, Wallet, Receipt, ArrowUpRight, ArrowDownRight, Plus, Loader2 } from "lucide-react";
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
  totalCommission: number;
  totalSettlements: number;
  totalAdjustments: number;
  pendingCashWithNurses: number;
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

interface PaymentRow {
  id: string;
  orderId: string;
  orderPublicNumber: string | null;
  orderTotal: number;
  method: "cash" | "online";
  status: "pending" | "paid" | "failed" | "refunded";
  amount: number;
  currency: string;
  paidAt: string | null;
  collectedAt: string | null;
  collectedByNurseName: string | null;
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

const STATUS_LABELS_AR: Record<PaymentRow["status"], string> = {
  pending:  "بانتظار الدفع",
  paid:     "مدفوع",
  failed:   "فشل",
  refunded: "مُسترد",
};

const METHOD_LABELS_AR: Record<PaymentRow["method"], string> = {
  cash:   "نقداً",
  online: "إلكتروني",
};

export function FinanceAdmin({ adminId, adminName, adminRole }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<"overview" | "nurses" | "payments" | "settlements">("overview");

  const [overview, setOverview] = useState<Overview | null>(null);
  const [wallets, setWallets] = useState<NurseWallet[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<NurseWallet | null>(null);

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
      {tab === "payments" && <PaymentsPane rows={payments} loading={loading} />}
      {tab === "settlements" && <SettlementsPane rows={settlements} loading={loading} />}

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
    </div>
  );
}

// ─── Panes ──────────────────────────────────────────────────────────────────

function OverviewPane({ overview, loading }: { overview: Overview | null; loading: boolean }) {
  if (loading && !overview) return <SkeletonGrid />;
  if (!overview) return <p className="text-sm text-gray-400 text-center py-10">لا توجد بيانات مالية بعد</p>;
  const { totalRevenue, totalCollected, totalCommission, totalSettlements, pendingCashWithNurses } = overview;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <Card icon={<Receipt size={18} className="text-[#0891B2]" />} label="إجمالي الإيرادات (الطلبات غير الملغاة)" value={formatPrice(totalRevenue)} />
      <Card icon={<Banknote size={18} className="text-emerald-600" />} label="المُحصَّل فعلياً" value={formatPrice(totalCollected)} />
      <Card icon={<ArrowUpRight size={18} className="text-amber-600" />} label="نقد لدى الممرضين" value={formatPrice(pendingCashWithNurses)} sub="رصيد المحفظة الصافي" />
      <Card icon={<ArrowDownRight size={18} className="text-purple-600" />} label="إجمالي العمولة" value={formatPrice(totalCommission)} />
      <Card icon={<Wallet size={18} className="text-cyan-700" />} label="إجمالي التسويات المدفوعة" value={formatPrice(totalSettlements)} />
    </div>
  );
}

function NursesPane({ wallets, loading, onPay }: { wallets: NurseWallet[]; loading: boolean; onPay: (w: NurseWallet) => void }) {
  if (loading && wallets.length === 0) return <SkeletonGrid />;
  if (wallets.length === 0) return <p className="text-sm text-gray-400 text-center py-10">لا يوجد ممرضون مسجَّلون</p>;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
            <th className="text-start py-2 px-3 font-semibold">الممرض</th>
            <th className="text-start py-2 px-3 font-semibold">المُحصَّل</th>
            <th className="text-start py-2 px-3 font-semibold">العمولة</th>
            <th className="text-start py-2 px-3 font-semibold">المُسوّى</th>
            <th className="text-start py-2 px-3 font-semibold">المستحق صافٍ</th>
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

function PaymentsPane({ rows, loading }: { rows: PaymentRow[]; loading: boolean }) {
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentRow["status"]>("all");
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
          {(Object.keys(STATUS_LABELS_AR) as PaymentRow["status"][]).map((s) => (
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
              <th className="text-start py-2 px-3 font-semibold">الحالة</th>
              <th className="text-start py-2 px-3 font-semibold">الممرض</th>
              <th className="text-start py-2 px-3 font-semibold">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6 text-xs">لا توجد مدفوعات</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 last:border-0">
                <td className="py-2 px-3"><span className="lat" dir="ltr">{r.orderPublicNumber ?? "—"}</span></td>
                <td className="py-2 px-3 font-semibold">{formatPrice(r.amount)}</td>
                <td className="py-2 px-3">{METHOD_LABELS_AR[r.method]}</td>
                <td className="py-2 px-3">{STATUS_LABELS_AR[r.status]}</td>
                <td className="py-2 px-3">{r.collectedByNurseName ?? "—"}</td>
                <td className="py-2 px-3 text-xs text-gray-500">
                  {r.collectedAt ? relativeTime(r.collectedAt) : r.paidAt ? relativeTime(r.paidAt) : relativeTime(r.createdAt)}
                </td>
              </tr>
            ))}
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
            <tr><td colSpan={5} className="text-center text-gray-400 py-6 text-xs">لا توجد تسويات</td></tr>
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
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
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
