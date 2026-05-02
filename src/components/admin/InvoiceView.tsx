"use client";
import { motion } from "framer-motion";
import { X, Printer, MessageCircle, Check, RotateCcw, Ban, FlaskConical } from "lucide-react";
import type { Invoice, PaymentStatus } from "@/lib/types";
import { formatPrice, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface InvoiceViewProps {
  invoice: Invoice;
  onClose: () => void;
  onStatusChange: (status: PaymentStatus) => void;
}

const STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "بانتظار الدفع",
  paid: "مدفوعة",
  refunded: "مستردّة",
  cancelled: "ملغاة",
};

const STATUS_COLOR: Record<PaymentStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  refunded: "bg-purple-50 text-purple-700",
  cancelled: "bg-red-50 text-red-600",
};

/**
 * Invoice viewer — opens as a modal on top of the dashboard.
 *  - Print button uses window.print() with the print stylesheet to render
 *    only the invoice. The .no-print rule hides the surrounding chrome.
 *  - WhatsApp button opens wa.me with a pre-filled invoice summary.
 *  - Status change buttons mutate the mock invoice in place; in production
 *    they would call an API and write to the activity log.
 */
export function InvoiceView({ invoice, onClose, onStatusChange }: InvoiceViewProps) {
  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  const handleWhatsApp = () => {
    if (typeof window === "undefined") return;
    const lines = [
      `*مختبرك — فاتورة رقم ${invoice.invoiceNumber}*`,
      `المريض: ${invoice.patientName}`,
      `تاريخ الإصدار: ${formatDate(invoice.issuedAt)}`,
      "",
      ...invoice.items.map((it) => `• ${it.nameAr} — ${formatPrice(it.total)}`),
      "",
      `المجموع الفرعي: ${formatPrice(invoice.subtotal)}`,
      invoice.couponDiscount > 0 ? `خصم الكوبون: -${formatPrice(invoice.couponDiscount)}` : "",
      `*الإجمالي: ${formatPrice(invoice.total)}*`,
      `حالة الدفع: ${STATUS_LABEL[invoice.paymentStatus]}`,
    ].filter(Boolean);
    const phone = invoice.customerPhone.replace(/\D/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-title"
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 md:p-6 no-print"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="bg-white w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Toolbar */}
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 no-print">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <h2 id="invoice-title" className="text-base font-bold text-[#164E63]">
              فاتورة {invoice.invoiceNumber}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleWhatsApp}>
              <MessageCircle size={14} aria-hidden="true" />
              واتساب
            </Button>
            <Button variant="secondary" size="sm" onClick={handlePrint}>
              <Printer size={14} aria-hidden="true" />
              طباعة / PDF
            </Button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8" id="invoice-body">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#ECFEFF] flex items-center justify-center">
                <FlaskConical size={22} className="text-[#0891B2]" aria-hidden="true" />
              </div>
              <div>
                <p className="text-base font-bold text-[#164E63]">مختبرك</p>
                <p className="text-[11px] text-gray-500">دمشق — سوريا</p>
              </div>
            </div>
            <div className="text-end">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide">رقم الفاتورة</p>
              <p className="text-base font-bold text-[#164E63] lat" dir="ltr">{invoice.invoiceNumber}</p>
              <p className="text-[11px] text-gray-500 mt-1">{formatDate(invoice.issuedAt)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-xl p-4 mb-5">
            <div>
              <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wide">المريض</p>
              <p className="text-sm font-semibold text-[#164E63]">{invoice.patientName}</p>
              <p className="text-[11px] text-gray-500 lat mt-0.5" dir="ltr">{invoice.customerPhone}</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wide">رقم الطلب</p>
              <p className="text-sm font-semibold text-[#164E63] lat" dir="ltr">{invoice.orderId}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {invoice.paymentMethod === "cash" ? "الدفع نقداً" : "دفع إلكتروني"}
                {" — "}
                <span className={`px-1.5 py-0.5 rounded ${STATUS_COLOR[invoice.paymentStatus]}`}>{STATUS_LABEL[invoice.paymentStatus]}</span>
              </p>
            </div>
          </div>

          {/* Items */}
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-200">
                <th className="text-start py-2">التحليل</th>
                <th className="text-end py-2 w-16">الكمية</th>
                <th className="text-end py-2 w-24">السعر</th>
                <th className="text-end py-2 w-24">المجموع</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id} className="border-b border-gray-50">
                  <td className="py-2.5">
                    <p className="text-[#164E63] font-medium">{it.nameAr}</p>
                    <p className="text-[11px] text-gray-400 lat" dir="ltr">{it.nameEn}</p>
                  </td>
                  <td className="text-end">{it.quantity}</td>
                  <td className="text-end">{formatPrice(it.unitPrice)}</td>
                  <td className="text-end font-semibold">{formatPrice(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="space-y-2 max-w-xs ms-auto">
            <Row label="المجموع الفرعي" value={formatPrice(invoice.subtotal)} />
            {invoice.packageDiscount > 0 && <Row label="خصم الباقة" value={`-${formatPrice(invoice.packageDiscount)}`} positive />}
            {invoice.couponDiscount > 0 && <Row label={`كوبون ${invoice.couponCode ?? ""}`} value={`-${formatPrice(invoice.couponDiscount)}`} positive />}
            {invoice.taxRate > 0 && <Row label={`الضريبة (${invoice.taxRate}%)`} value={formatPrice(invoice.taxAmount)} />}
            <div className="h-px bg-gray-200 my-1" />
            <div className="flex justify-between">
              <span className="text-base font-bold text-[#164E63]">الإجمالي</span>
              <span className="text-base font-bold text-[#164E63]">{formatPrice(invoice.total)}</span>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 text-center mt-8 leading-relaxed">
            شكراً لاختياركم مختبرك — لأي استفسار يرجى التواصل عبر واتساب على رقم {invoice.customerPhone}
          </p>
        </div>

        {/* Status update toolbar */}
        <footer className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 no-print">
          <p className="text-xs text-gray-500">تحديث حالة الدفع</p>
          <div className="flex gap-2">
            <button
              onClick={() => onStatusChange("paid")}
              disabled={invoice.paymentStatus === "paid"}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-emerald-50 text-emerald-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={12} aria-hidden="true" /> مدفوع
            </button>
            <button
              onClick={() => onStatusChange("pending")}
              disabled={invoice.paymentStatus === "pending"}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-amber-50 text-amber-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              معلّق
            </button>
            <button
              onClick={() => onStatusChange("refunded")}
              disabled={invoice.paymentStatus === "refunded"}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-purple-50 text-purple-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw size={12} aria-hidden="true" /> استرداد
            </button>
            <button
              onClick={() => onStatusChange("cancelled")}
              disabled={invoice.paymentStatus === "cancelled"}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-red-50 text-red-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Ban size={12} aria-hidden="true" /> إلغاء
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

function Row({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${positive ? "text-[#059669]" : "text-[#164E63]"}`}>{value}</span>
    </div>
  );
}
