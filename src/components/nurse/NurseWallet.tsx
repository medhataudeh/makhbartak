"use client";
import { useEffect, useMemo, useState } from "react";
import { Banknote, ArrowDownRight, ArrowUpRight, Wallet, RotateCcw, Loader2, Sliders } from "lucide-react";
import { formatPrice, relativeTime } from "@/lib/utils";

// Phase 5.2 — nurse-facing wallet view. Mobile-first, Arabic, RTL.
//
// Source-of-truth contract:
//   * Numbers come from /api/nurses/[id]/wallet which reads the canonical
//     ledger. UI does no math.
//   * No localStorage caching — every mount hydrates.

interface Props { nurseId: string }

interface Summary {
  totalCollected: number;
  totalCommission: number;
  totalSettled: number;
  totalAdjustments: number;
  totalRefunded: number;
  netDue: number;
}

interface Transaction {
  id: string;
  orderId: string | null;
  orderPublicNumber: string | null;
  paymentId: string | null;
  type: "cash_collected" | "commission_earned" | "settlement_paid" | "adjustment" | "cash_refund" | "refund";
  direction: "credit" | "debit";
  amount: number;
  currency: string;
  descriptionAr: string;
  commissionRate: number | null;
  createdAt: string;
}

interface WalletPayload {
  wallet: { balance: number; currency: string; updatedAt: string | null };
  summary: Summary;
  transactions: Transaction[];
}

type TypeFilter = "all" | Transaction["type"];

const TYPE_LABEL: Record<Transaction["type"], string> = {
  cash_collected:   "تحصيل نقدي",
  commission_earned: "عمولة",
  settlement_paid:  "تسوية",
  adjustment:       "تعديل",
  cash_refund:      "استرجاع",
  refund:           "استرجاع",
};

export function NurseWallet({ nurseId }: Props) {
  const [data, setData] = useState<WalletPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const url = `/api/nurses/${encodeURIComponent(nurseId)}/wallet${params.toString() ? `?${params.toString()}` : ""}`;
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (res.ok) setData(await res.json());
      } catch { /* aborted */ }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [nurseId, typeFilter, from, to]);

  const summary = data?.summary;
  const transactions = data?.transactions ?? [];

  return (
    <div className="flex flex-col pb-nav bg-gray-50/40 min-h-screen">
      <header className="px-4 pt-5 pb-3 bg-white border-b border-gray-100">
        <h1 className="text-xl font-bold text-[#164E63]">المحفظة</h1>
        <p className="text-xs text-gray-400 mt-0.5">حركاتك المالية وعمولاتك والتسويات.</p>
      </header>

      {/* Summary cards */}
      <div className="px-4 py-4 space-y-3">
        <BalanceCard
          balance={data?.wallet.balance ?? 0}
          loading={loading}
        />
        <div className="grid grid-cols-2 gap-3">
          <Stat
            icon={<Banknote size={16} className="text-emerald-600" />}
            label="إجمالي المقبوضات"
            value={formatPrice(summary?.totalCollected ?? 0)}
            tone="positive"
          />
          <Stat
            icon={<ArrowDownRight size={16} className="text-purple-600" />}
            label="إجمالي العمولة"
            value={formatPrice(summary?.totalCommission ?? 0)}
            tone="negative"
          />
          <Stat
            icon={<ArrowUpRight size={16} className="text-cyan-700" />}
            label="التسويات المدفوعة"
            value={formatPrice(summary?.totalSettled ?? 0)}
            tone="negative"
          />
          <Stat
            icon={<RotateCcw size={16} className="text-rose-600" />}
            label="إجمالي الاسترجاعات"
            value={formatPrice(summary?.totalRefunded ?? 0)}
            tone="negative"
          />
        </div>
      </div>

      {/* Sticky filters */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Sliders size={14} className="text-gray-400" aria-hidden="true" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs cursor-pointer"
            aria-label="نوع الحركة"
          >
            <option value="all">كل الحركات</option>
            {(Object.keys(TYPE_LABEL) as Transaction["type"][]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-2 rounded-lg border border-gray-200 text-xs cursor-pointer"
            aria-label="من تاريخ"
          />
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-9 px-2 rounded-lg border border-gray-200 text-xs cursor-pointer"
            aria-label="إلى تاريخ"
          />
        </div>
      </div>

      {/* Transactions list */}
      <div className="px-4 py-4">
        {loading && !data ? (
          <SkeletonList />
        ) : transactions.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-2">
            {transactions.map((t) => (
              <TxnRow key={t.id} txn={t} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BalanceCard({ balance, loading }: { balance: number; loading: boolean }) {
  // The "current balance" is what the nurse currently owes the platform OR
  // is owed by it. Positive = nurse holds platform money. Negative is rare
  // and means the platform overpaid via adjustment.
  const positive = balance >= 0;
  return (
    <div className="bg-[#0891B2] rounded-2xl p-5 text-white relative overflow-hidden">
      <div className="absolute -bottom-6 -end-6 opacity-10">
        <Wallet size={120} aria-hidden="true" />
      </div>
      <p className="text-xs text-cyan-100">الرصيد الحالي</p>
      <p className="text-3xl font-bold mt-1.5">
        {loading ? <Loader2 size={24} className="animate-spin" /> : formatPrice(balance)}
      </p>
      <p className="text-[11px] text-cyan-100 mt-2">
        {positive ? "مبلغ يجب توريده للمنصة" : "صافٍ بعد التسويات"}
      </p>
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "positive" | "negative" | "neutral" }) {
  const valueClass =
    tone === "positive" ? "text-emerald-700"
    : tone === "negative" ? "text-rose-600"
    : "text-[#164E63]";
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">{icon}</div>
        <p className="text-[11px] text-gray-500 font-medium truncate">{label}</p>
      </div>
      <p className={`text-base font-bold mt-1.5 ${valueClass}`}>{value}</p>
    </div>
  );
}

function TxnRow({ txn }: { txn: Transaction }) {
  const isCredit = txn.direction === "credit";
  const tone = isCredit ? "text-emerald-700" : "text-rose-600";
  const sign = isCredit ? "+" : "−";
  const dateLabel = useMemo(() => relativeTime(txn.createdAt), [txn.createdAt]);
  return (
    <li className="bg-white rounded-xl border border-gray-100 p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#164E63] truncate">
            {TYPE_LABEL[txn.type] ?? txn.type}
            {txn.commissionRate !== null && (
              <span className="text-[11px] text-gray-400 ms-2">({txn.commissionRate}%)</span>
            )}
          </p>
          {txn.orderPublicNumber && (
            <p className="text-[11px] text-gray-400 mt-0.5 lat" dir="ltr">{txn.orderPublicNumber}</p>
          )}
          <p className="text-xs text-gray-500 mt-1 leading-snug">{txn.descriptionAr}</p>
        </div>
        <div className="text-end">
          <p className={`text-sm font-bold ${tone}`}>{sign} {formatPrice(txn.amount)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{dateLabel}</p>
        </div>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-14 px-6 text-sm text-gray-400">
      <Wallet size={36} className="mx-auto text-gray-200 mb-3" aria-hidden="true" />
      لا توجد أي حركات مالية حالياً
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-xl bg-gray-50 animate-pulse" />
      ))}
    </div>
  );
}
