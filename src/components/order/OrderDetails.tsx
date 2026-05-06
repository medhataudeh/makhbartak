"use client";
import { motion } from "framer-motion";
import { X, Clock, MapPin, User, Download, Phone, FlaskConical, Check, AlertTriangle, Eye, FileText, MessageCircle } from "lucide-react";
import Image from "next/image";
import type { Order } from "@/lib/types";
import { CUSTOMER_STATUS_STEPS, CUSTOMER_STATUS_LABELS, DEFAULT_LAB_ISSUE_CUSTOMER_MESSAGE_AR } from "@/lib/types";
import { formatDate, formatPrice, getShiftLabel } from "@/lib/utils";
import { CustomerStatusBadge } from "@/components/ui/CustomerStatusBadge";
import { Button } from "@/components/ui/Button";
import { ICON_MAP } from "@/components/order/InstructionIcons";
import { ClipboardList } from "lucide-react";
import { toCustomerStatus, customerStatusIndex } from "@/lib/order-status";
import { customerOrderRef, instructionsForOrder, isStructuredInstructions } from "@/lib/order-utils";
import type { TestInstruction, Instruction } from "@/lib/types";
import { useContentPage } from "@/lib/content-pages";
import { OrderRatingCard } from "@/components/order/OrderRatingCard";

interface OrderDetailsProps {
  order: Order;
  onClose: () => void;
  /** Phase 4.4 — when set, an "ادفع الآن" button is shown for online
   *  orders that are pending or failed. The host page is responsible for
   *  rendering the StripePaymentScreen. */
  onPayOnline?: (orderId: string) => void;
}

export function OrderDetails({ order, onClose, onPayOnline }: OrderDetailsProps) {
  const customer = toCustomerStatus(order.status);
  const stepIdx = customerStatusIndex(customer);
  const isAttention = customer === "needs_attention";
  const totalSteps = CUSTOMER_STATUS_STEPS.length;
  const progressPct = Math.max(4, Math.round((Math.max(stepIdx, 0) / (totalSteps - 1)) * 100));
  const resultFiles = (order.resultFiles ?? []).filter((f) => f.isActive);
  const hasResults = resultFiles.length > 0;
  const pkg = order.packageSnapshot;
  const support = useContentPage("support");

  // Customer-facing message for any open lab issue. Admin can override per issue;
  // otherwise we show a single safe default.
  const openIssue = (order.issues ?? []).find((i) => i.status !== "resolved");
  const customerIssueMessage =
    openIssue?.customerMessageAr || (isAttention ? DEFAULT_LAB_ISSUE_CUSTOMER_MESSAGE_AR : null);

  const supportPhone = support?.supportPhone;
  const supportWhatsapp = support?.supportWhatsapp;

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-50 bg-white flex flex-col"
      style={{ maxWidth: "448px", margin: "0 auto" }}
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل الطلب"
    >
      <div className="flex items-center gap-3 px-4 pb-4 border-b border-gray-100 bg-white safe-top-md">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center cursor-pointer transition-colors active:bg-gray-200"
          aria-label="إغلاق"
        >
          <X size={18} className="text-[#164E63]" aria-hidden="true" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-bold text-[#164E63]">تفاصيل الطلب</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            <span className="lat ltr-tech">{customerOrderRef(order)}</span>
          </p>
        </div>
        <CustomerStatusBadge status={order.status} />
      </div>

      <div className="flex-1 overflow-y-auto pb-cta">
        {/* RESULT-FIRST hoist — when results exist they become the most prominent thing on screen. */}
        {hasResults && (
          <div className="mx-4 mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Check size={16} strokeWidth={3} className="text-emerald-700" aria-hidden="true" />
              <p className="text-sm font-bold text-emerald-800">اكتمل طلبك — نتمنى لك الصحة والعافية</p>
            </div>
            <p className="text-xs text-emerald-800/80 leading-relaxed">
              يمكنك الآن عرض النتيجة أو تنزيلها. إذا احتجت أي مساعدة أو توضيح، فريق الدعم على بُعد رسالة.
            </p>
            <div className="space-y-2">
              {resultFiles.map((f) => (
                <div key={f.id} className="bg-white rounded-xl border border-emerald-100 p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <FileText size={18} className="text-emerald-700" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#164E63] truncate">{f.fileName}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(f.uploadedAt)}</p>
                  </div>
                  <a
                    href={f.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer active:bg-emerald-700"
                  >
                    <Eye size={13} aria-hidden="true" />
                    عرض النتيجة
                  </a>
                  <a
                    href={f.fileUrl}
                    download={f.fileName}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-700 text-xs font-semibold cursor-pointer active:bg-emerald-50"
                    aria-label={`تحميل ${f.fileName}`}
                  >
                    <Download size={13} aria-hidden="true" />
                    تحميل
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Customer-facing lab issue banner */}
        {customerIssueMessage && (
          <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-amber-800">تحديث على طلبك</p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">{customerIssueMessage}</p>
            </div>
          </div>
        )}

        {/* Progress (or attention banner without an explicit lab issue) */}
        {isAttention && !customerIssueMessage ? (
          <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-amber-800">طلبك يحتاج متابعة</p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                واجهنا مشكلة في إكمال الطلب. تواصل مع الدعم لإكمال الإجراء أو إعادة الجدولة.
              </p>
            </div>
          </div>
        ) : !isAttention ? (
          <div className="px-5 py-5 bg-gray-50/60 border-b border-gray-100">
            <div className="relative mb-3">
              <div className="absolute top-2.5 inset-x-0 h-0.5 bg-gray-200 rounded-full" aria-hidden="true" />
              <motion.div
                initial={{ width: "0%" }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="absolute top-2.5 start-0 h-0.5 bg-[#0891B2] rounded-full"
                aria-hidden="true"
              />
              <div className="relative flex justify-between">
                {CUSTOMER_STATUS_STEPS.map((s, i) => {
                  const done = i <= Math.max(stepIdx, 0);
                  return (
                    <div key={s} className="flex flex-col items-center gap-1.5">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${done ? "border-[#0891B2] bg-[#0891B2] text-white" : "border-gray-300 bg-white"}`}>
                        {done && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                      </div>
                      <span className={`text-[10px] font-medium leading-none text-center ${done ? "text-[#0891B2]" : "text-gray-400"}`}>
                        {CUSTOMER_STATUS_LABELS[s].split(" ").slice(0, 2).join(" ")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {/* Rating card — once order is completed. */}
        {customer === "completed" && (
          <div className="pt-4">
            <OrderRatingCard order={order} />
          </div>
        )}

        {/* Visit details */}
        <div className="px-4 py-4">
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            <InfoRow icon={<Clock size={15} className="text-[#0891B2]" />} label="الموعد" value={`${formatDate(order.visitDate)} · ${getShiftLabel(order.shift)}`} />
            <InfoRow icon={<MapPin size={15} className="text-[#059669]" />} label="العنوان" value={`${order.address.label} – ${order.address.description}`} />
            <InfoRow icon={<User size={15} className="text-purple-600" />} label="المريض" value={order.patient.name} />
          </div>
        </div>

        {/* Phase 3.6 — uploaded prescription image. Only renders when the
           customer chose the prescription flow and the file landed in the
           `prescriptions` bucket. URL is signed by enrichOrdersWithSignedUrls. */}
        {order.prescriptionUrl && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">الوصفة المرفوعة</h3>
            <a
              href={order.prescriptionUrl}
              target="_blank"
              rel="noreferrer"
              className="block bg-white rounded-xl border border-gray-100 overflow-hidden cursor-pointer active:bg-gray-50"
            >
              <div className="relative w-full h-48 bg-gray-50">
                <Image src={order.prescriptionUrl} alt="الوصفة الطبية" fill sizes="(max-width: 768px) 100vw, 448px" className="object-contain" />
              </div>
              <p className="text-[11px] text-gray-500 px-3 py-2 text-center">اضغط لفتح الصورة الكاملة</p>
            </a>
          </div>
        )}

        {/* Items — package shows as ONE card, others list tests */}
        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {pkg ? "الباقة" : "التحاليل"}
          </h3>
          {pkg ? (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-50 flex-shrink-0 relative">
                  <Image src={pkg.image} alt="" fill sizes="64px" className="object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#164E63]">{pkg.nameAr}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{pkg.testsCount} تحاليل</p>
                </div>
                <p className="text-sm font-bold text-[#164E63]">{formatPrice(pkg.price)}</p>
              </div>
              <div className="px-4 py-3 bg-gray-50 flex justify-between border-t border-gray-100">
                <span className="text-sm font-bold text-[#164E63]">الإجمالي</span>
                <span className="text-sm font-bold text-[#164E63]">{formatPrice(order.total)}</span>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {order.items.map((item, i) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-4 py-3 ${i < order.items.length - 1 ? "border-b border-gray-50" : ""}`}
                >
                  <FlaskConical size={13} className="text-gray-300 flex-shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#164E63] truncate">{item.nameAr}</p>
                    <p className="text-xs text-gray-400 lat">{item.nameEn}</p>
                  </div>
                  <p className="text-sm font-bold text-[#164E63] flex-shrink-0">{formatPrice(item.priceSnapshot)}</p>
                </div>
              ))}
              <div className="px-4 py-3 bg-gray-50 flex justify-between border-t border-gray-100">
                <span className="text-sm font-bold text-[#164E63]">الإجمالي</span>
                <span className="text-sm font-bold text-[#164E63]">{formatPrice(order.total)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Phase 4.4 — payment block. Cash and online both surface the
            method + status; online additionally exposes "ادفع الآن" /
            "جاري التحقق من الدفع" depending on the lifecycle position. */}
        <PaymentBlock order={order} onPayOnline={onPayOnline} />

        {/* Instructions — aggregated from per-test customerInstructions
            (deduped by key), with legacy fallback handled by the helper. */}
        <InstructionsBlock order={order} />

        {/* Legacy single-file fallback (deprecated `resultPdfUrl`) */}
        {!hasResults && order.resultPdfUrl && (
          <div className="px-4 pb-4">
            <Button variant="secondary" size="md" className="w-full">
              <Download size={17} aria-hidden="true" />
              تحميل نتيجة التحاليل
            </Button>
          </div>
        )}
      </div>

      {/* Sticky support footer — phone + WhatsApp pulled from CMS */}
      <div className="px-4 pt-3 border-t border-gray-100 bg-white safe-bottom-md">
        <div className="flex gap-2">
          {supportPhone && (
            <a
              href={`tel:${supportPhone.replace(/\s+/g, "")}`}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#ECFEFF] cursor-pointer active:bg-cyan-100 transition-colors"
            >
              <Phone size={16} className="text-[#0891B2]" aria-hidden="true" />
              <span className="text-sm font-semibold text-[#0891B2]">اتصال</span>
            </a>
          )}
          {supportWhatsapp ? (
            <a
              href={`https://wa.me/${supportWhatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank" rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 cursor-pointer active:bg-emerald-100 transition-colors"
            >
              <MessageCircle size={16} className="text-emerald-700" aria-hidden="true" />
              <span className="text-sm font-semibold text-emerald-700">واتساب الدعم</span>
            </a>
          ) : (
            <button className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#ECFEFF] cursor-pointer active:bg-cyan-100 transition-colors">
              <Phone size={16} className="text-[#0891B2]" aria-hidden="true" />
              <span className="text-sm font-semibold text-[#0891B2]">التواصل مع الدعم</span>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Phase 4.4 — customer-facing payment block. Surfaces method + status, and
// for online orders gates the "ادفع الآن" button on the actual payment row
// state (not just orders.payment_status, so a webhook-pending order shows
// "جاري التحقق" instead of inviting another payment).
function PaymentBlock({ order, onPayOnline }: { order: Order; onPayOnline?: (orderId: string) => void }) {
  const isCash = order.paymentMethod === "cash";
  const isOnline = order.paymentMethod === "online";
  const status = order.paymentStatus;

  const methodLabel = isCash ? "نقداً عند الاستلام" : "إلكتروني";
  const statusLabel: string =
    status === "paid"     ? "تم الدفع"
    : status === "failed" ? "فشل الدفع"
    : status === "refunded" ? "تم الاسترجاع"
    : "بانتظار الدفع";

  const showPayNow = isOnline && (status === "pending" || status === "failed") && !!onPayOnline;

  return (
    <div className="px-4 pb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">الدفع</h3>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">طريقة الدفع</span>
          <span className="text-sm font-semibold text-[#164E63]">{methodLabel}</span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between border-t border-gray-50">
          <span className="text-xs text-gray-500">حالة الدفع</span>
          <span className={`text-sm font-semibold ${status === "paid" ? "text-emerald-700" : status === "failed" ? "text-rose-600" : status === "refunded" ? "text-gray-500" : "text-amber-700"}`}>
            {statusLabel}
          </span>
        </div>
        {showPayNow && (
          <div className="px-4 py-3 border-t border-gray-50">
            <Button
              size="md"
              variant="primary"
              className="w-full"
              onClick={() => onPayOnline!(order.id)}
            >
              ادفع الآن — {formatPrice(order.total)}
            </Button>
            {status === "failed" && (
              <p className="text-[11px] text-rose-600 text-center mt-2">
                فشلت محاولة الدفع السابقة. حاول مرة أخرى.
              </p>
            )}
          </div>
        )}
        {isOnline && status === "pending" && !showPayNow && (
          <div className="px-4 py-3 border-t border-gray-50 text-xs text-amber-700 text-center">
            جاري التحقق من الدفع…
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium text-[#164E63] leading-snug mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

function InstructionsBlock({ order }: { order: import("@/lib/types").Order }) {
  const list = instructionsForOrder(order);
  if (list.length === 0) return null;
  const isStructured = isStructuredInstructions(list);
  return (
    <div className="px-4 pb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">تعليمات</h3>
      <div className="space-y-1.5">
        {list.map((ins) => (
          <div key={ins.id} className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              {ICON_MAP[ins.icon] ?? <ClipboardList size={16} className="text-gray-400" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              {isStructured ? (
                <>
                  <p className="text-sm font-semibold text-[#164E63]">{(ins as TestInstruction).titleAr}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{(ins as TestInstruction).bodyAr}</p>
                </>
              ) : (
                <p className="text-sm text-[#164E63]">{(ins as Instruction).textAr}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
