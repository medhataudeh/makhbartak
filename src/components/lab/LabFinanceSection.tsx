"use client";
import { useEffect, useState } from "react";
import { Banknote, Wallet, Receipt, Loader2, ListChecks } from "lucide-react";
import { formatPrice, relativeTime } from "@/lib/utils";

// Phase 5.2 — lab finance section. Reads from /api/labs/[id]/wallet which
// hits the lab_wallets + lab_finance_summary view. UI does no math.

interface Brand { primaryColor: string; secondaryColor: string; accentColor: string }

interface Props {
  labId: string;
  brand: Brand;
}

interface Summary {
  totalEarnings: number;
  totalSettled: number;
  totalAdjustments: number;
  completedOrders: number;
  avgEarning: number;
  netDue: number;
}

interface Transaction {
  id: string;
  orderId: string | null;
  orderPublicNumber: string | null;
  type: "earning" | "settlement_paid" | "adjustment";
  direction: "credit" | "debit";
  amount: number;
  currency: string;
  descriptionAr: string;
  payoutSnapshot: unknown;
  createdAt: string;
}

interface Payload {
  wallet: { balance: number; currency: string; updatedAt: string | null };
  summary: Summary;
  transactions: Transaction[];
}

const TYPE_LABEL: Record<Transaction["type"], string> = {
  earning:         "مستحقات",
  settlement_paid: "تسوية مستلمة",
  adjustment:      "تعديل",
};

export function LabFinanceSection({ labId, brand }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/wallet`, { cache: "no-store", signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (res.ok) setData(await res.json());
      } catch { /* aborted */ }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [labId]);

  const summary = data?.summary;
  const earnings = (data?.transactions ?? []).filter((t) => t.type === "earning");
  const settlements = (data?.transactions ?? []).filter((t) => t.type === "settlement_paid" || t.type === "adjustment");

  return (
    <div className="px-4 md:px-6 py-5 space-y-5">
      <header>
        <h2 className="text-base font-bold text-[#164E63]">المالية</h2>
        <p className="text-xs text-gray-500 mt-0.5">المستحقات الحالية، التسويات المستلمة، وحركات الحساب.</p>
      </header>

      {/* Defensive: the wallet read returned nothing (no data yet, or the API
          responded 401/403/404/500). Show a clear Arabic notice rather than
          silently rendering zeros. Never throws — all values below are guarded. */}
      {!loading && !data && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700 leading-relaxed">
            لا تتوفر بيانات مالية حالياً. إذا استمرت المشكلة، حدّث الصفحة أو تواصل مع الإدارة.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={<Receipt size={18} className="text-emerald-700" />} label="إجمالي المستحقات" value={formatPrice(summary?.totalEarnings ?? 0)} loading={loading} />
        <Card icon={<Banknote size={18} className="text-cyan-700" />} label="التسويات المستلمة" value={formatPrice(summary?.totalSettled ?? 0)} loading={loading} />
        <Card icon={<Wallet size={18} style={{ color: brand.primaryColor }} />} label="الرصيد المتبقي" value={formatPrice(summary?.netDue ?? 0)} loading={loading} highlight={brand.primaryColor} />
        <Card icon={<ListChecks size={18} className="text-purple-700" />} label="عدد الطلبات المكتملة" value={String(summary?.completedOrders ?? 0)} sub={summary?.avgEarning ? `متوسط ${formatPrice(summary.avgEarning)} للطلب` : undefined} loading={loading} />
      </div>

      {/* Earnings table */}
      <Section title="مستحقات الطلبات">
        {loading && earnings.length === 0 ? <Skeleton /> : earnings.length === 0 ? <Empty /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="text-start py-2 px-3 font-semibold">رقم الطلب</th>
                <th className="text-start py-2 px-3 font-semibold">المبلغ</th>
                <th className="text-start py-2 px-3 font-semibold">الوصف</th>
                <th className="text-start py-2 px-3 font-semibold">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((t) => (
                <tr key={t.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 px-3 lat" dir="ltr">{t.orderPublicNumber ?? "—"}</td>
                  <td className="py-2 px-3 font-semibold text-emerald-700">{formatPrice(t.amount)}</td>
                  <td className="py-2 px-3 text-xs text-gray-600">{t.descriptionAr}</td>
                  <td className="py-2 px-3 text-xs text-gray-400">{relativeTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Settlement history */}
      <Section title="سجل التسويات">
        {loading && settlements.length === 0 ? <Skeleton /> : settlements.length === 0 ? <Empty /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="text-start py-2 px-3 font-semibold">المبلغ</th>
                <th className="text-start py-2 px-3 font-semibold">النوع</th>
                <th className="text-start py-2 px-3 font-semibold">الوصف</th>
                <th className="text-start py-2 px-3 font-semibold">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((t) => (
                <tr key={t.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 px-3 font-semibold text-cyan-700">{formatPrice(t.amount)}</td>
                  <td className="py-2 px-3 text-xs">{TYPE_LABEL[t.type]}</td>
                  <td className="py-2 px-3 text-xs text-gray-600">{t.descriptionAr}</td>
                  <td className="py-2 px-3 text-xs text-gray-400">{relativeTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Card({ icon, label, value, sub, loading, highlight }: { icon: React.ReactNode; label: string; value: string; sub?: string; loading?: boolean; highlight?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3" style={highlight ? { borderColor: highlight } : undefined}>
      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-500 font-medium truncate">{label}</p>
        <p className="text-base font-bold text-[#164E63] mt-0.5">
          {loading ? <Loader2 size={16} className="animate-spin" /> : value}
        </p>
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

function Empty() {
  return <p className="text-sm text-gray-400 text-center py-8">لا توجد بيانات مالية حالياً</p>;
}
function Skeleton() {
  return <div className="h-24 bg-gray-50 animate-pulse" />;
}
