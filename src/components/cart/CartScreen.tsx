"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { Tag, CreditCard, Banknote, MapPin, User, Clock, Trash2, Pencil } from "lucide-react";
import type { Test, Package, Shift, Address, Patient, PaymentMethod } from "@/lib/types";
import { validateCoupon } from "@/lib/mock-data";
import { USE_SUPABASE } from "@/lib/supabase/flags";
import { formatPrice, getShiftLabel } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { BackButton } from "@/components/ui/BackButton";
import { usePreferredPayment, setPreferredPayment } from "@/lib/payment-pref";

export interface CartConfirmSnapshot {
  paymentMethod: PaymentMethod;
  /** Stable key for the lifetime of this CartScreen mount — duplicate clicks
   *  reuse the same key, and the order store dedupes accordingly. */
  idempotencyKey: string;
  subtotal: number;
  couponCode?: string;
  couponDiscount: number;
  total: number;
  /** Snapshot of the package at the time of confirmation. */
  packageSnapshot?: { packageId: string; nameAr: string; nameEn: string; image: string; testsCount: number; price: number };
  /** Items lines — for package orders, items are the package's tests. */
  items: { id: string; testId: string; nameAr: string; nameEn: string; priceSnapshot: number }[];
  type: "package" | "custom" | "prescription";
  packageNameAr?: string;
}

interface CartScreenProps {
  tests?: Test[];
  pkg?: Package;
  shift: Shift;
  address: Address;
  patient: Patient;
  onConfirm: (snapshot: CartConfirmSnapshot) => void | Promise<void>;
  onBack: () => void;
}

export function CartScreen({ tests, pkg, shift, address, patient, onConfirm, onBack }: CartScreenProps) {
  const savedMethod = usePreferredPayment();
  // Idempotency key: stable for this CartScreen mount. Duplicate confirm
  // clicks reuse the same key; createOrder dedupes server-side.
  const [idempotencyKey] = useState(() => `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const [couponCode, setCouponCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState(0);
  const [couponMessage, setCouponMessage] = useState<{ text: string; valid: boolean } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [paymentSheet, setPaymentSheet] = useState(false);
  const [removeSheet, setRemoveSheet] = useState<Test | null>(null);
  const [localTests, setLocalTests] = useState<Test[]>(tests ?? []);
  const [orderLoading, setOrderLoading] = useState(false);

  // Always have a value: saved preference, else cash by default for SY market.
  // The user can change via the bottom sheet but is never *forced* to pick.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(savedMethod ?? "cash");

  // Subtotal: package counts as ONE line at its package price.
  // Coupon applies to subtotal regardless of order type (package, custom, prescription).
  const subtotal = pkg ? pkg.price : localTests.reduce((s, t) => s + t.sellPrice, 0);
  const couponDiscount = appliedDiscount;
  const total = Math.max(0, subtotal - couponDiscount);

  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) return;
    setCouponLoading(true);
    let valid = false;
    let discount = 0;
    let message = "";
    if (USE_SUPABASE) {
      try {
        const res = await fetch(`/api/coupons/validate?code=${encodeURIComponent(code)}&total=${encodeURIComponent(subtotal)}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        valid = !!body.valid;
        discount = Number(body.discount ?? 0);
        message = body.message ?? "الكوبون غير صالح";
      } catch {
        message = "تعذر التحقق من الكوبون";
      }
    } else {
      await new Promise((r) => setTimeout(r, 700));
      const result = validateCoupon(code, subtotal);
      valid = !!result.valid;
      discount = result.discount ?? 0;
      message = result.message;
    }
    setCouponLoading(false);
    if (valid && discount > 0) {
      setAppliedDiscount(discount);
      setCouponMessage({ text: message, valid: true });
    } else {
      setAppliedDiscount(0);
      setCouponMessage({ text: message, valid: false });
    }
  };

  const removeCoupon = () => {
    setCouponCode("");
    setAppliedDiscount(0);
    setCouponMessage(null);
  };

  const handleConfirm = async () => {
    if (orderLoading) return; // double-click guard
    setOrderLoading(true);
    setPreferredPayment(paymentMethod);
    await new Promise((r) => setTimeout(r, 800));
    // Build line items for the snapshot. Package orders carry the package
    // tests so admin/nurse/lab see operational details (parent/child).
    const items = pkg
      ? pkg.tests.map((t, i) => ({ id: `oi-${idempotencyKey}-${i}`, testId: t.id, nameAr: t.nameAr, nameEn: t.nameEn, priceSnapshot: t.sellPrice }))
      : localTests.map((t, i) => ({ id: `oi-${idempotencyKey}-${i}`, testId: t.id, nameAr: t.nameAr, nameEn: t.nameEn, priceSnapshot: t.sellPrice }));

    try {
      await onConfirm({
        paymentMethod,
        idempotencyKey,
        subtotal,
        couponCode: appliedDiscount > 0 ? couponCode : undefined,
        couponDiscount,
        total,
        packageSnapshot: pkg ? {
          packageId: pkg.id, nameAr: pkg.nameAr, nameEn: pkg.nameEn,
          image: pkg.mainImage, testsCount: pkg.tests.length, price: pkg.price,
        } : undefined,
        items,
        type: pkg ? "package" : "custom",
        packageNameAr: pkg?.nameAr,
      });
    } finally {
      // Reset only on failure-stay-on-screen path. On success the screen has
      // already navigated away, so this is a no-op.
      setOrderLoading(false);
    }
  };

  const choosePayment = (m: PaymentMethod) => {
    setPaymentMethod(m);
    setPreferredPayment(m);
    setPaymentSheet(false);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/40">
      <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-100">
        <BackButton onClick={onBack} />
        <h1 className="text-[16px] font-bold text-[#164E63]">مراجعة الطلب</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-cta">
        {/* Items — package = ONE line, no test breakdown */}
        <Section title="السلة">
          {pkg ? (
            <div className="flex items-center gap-3 px-4 py-4">
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-50 flex-shrink-0 relative">
                <Image src={pkg.mainImage} alt="" fill sizes="64px" className="object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#164E63] truncate">{pkg.nameAr}</p>
                <p className="text-xs text-gray-400 mt-0.5">{pkg.tests.length} تحاليل</p>
              </div>
              <p className="text-sm font-bold text-[#164E63] flex-shrink-0">{formatPrice(pkg.price)}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {localTests.map((test) => (
                <div key={test.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#164E63] truncate">{test.nameAr}</p>
                    <p className="text-xs text-gray-400 mt-0.5 lat">{test.nameEn}</p>
                  </div>
                  <p className="text-sm font-bold text-[#164E63] flex-shrink-0">{formatPrice(test.sellPrice)}</p>
                  <button
                    onClick={() => setRemoveSheet(test)}
                    aria-label={`حذف ${test.nameAr}`}
                    className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center cursor-pointer ms-1 active:bg-red-100 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={14} className="text-red-400" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Coupon — ALWAYS visible (package, custom, prescription) */}
        <Section title="كوبون الخصم">
          <div className="px-4 py-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponMessage(null); }}
                onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                placeholder="كود الكوبون"
                aria-label="كود الكوبون"
                className="flex-1 h-11 px-4 rounded-xl border border-gray-200 text-sm text-[#164E63] placeholder:text-gray-400 focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/15 focus:outline-none transition-all"
                style={{ direction: "ltr", textAlign: "right" }}
              />
              {appliedDiscount > 0 ? (
                <Button variant="ghost" size="sm" onClick={removeCoupon} className="h-11">
                  إزالة
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={applyCoupon} loading={couponLoading} className="h-11 gap-1.5">
                  <Tag size={14} aria-hidden="true" />
                  تطبيق
                </Button>
              )}
            </div>
            <AnimatePresence>
              {couponMessage && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  role="alert"
                  className={`text-xs mt-2 font-semibold ${couponMessage.valid ? "text-[#059669]" : "text-red-500"}`}
                >
                  {couponMessage.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </Section>

        {/* Visit details */}
        <Section title="تفاصيل الزيارة">
          <div className="divide-y divide-gray-50">
            <DetailRow icon={<Clock size={15} className="text-[#0891B2]" />} label="الموعد" value={getShiftLabel(shift)} />
            <DetailRow icon={<MapPin size={15} className="text-[#059669]" />} label="العنوان" value={`${address.label} – ${address.description}`} />
            <DetailRow icon={<User size={15} className="text-purple-600" />} label="المريض" value={patient.name} />
          </div>
        </Section>

        {/* Saved payment method — shown directly with edit affordance */}
        <Section title="طريقة الدفع">
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0">
              {paymentMethod === "online" ? (
                <CreditCard size={17} className="text-[#0891B2]" aria-hidden="true" />
              ) : (
                <Banknote size={17} className="text-[#059669]" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#164E63]">
                {paymentMethod === "online" ? "الدفع الإلكتروني" : "الدفع عند الاستلام"}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {savedMethod ? "محفوظ من اختيارك السابق" : "يمكنك تغيير طريقة الدفع"}
              </p>
            </div>
            <button
              onClick={() => setPaymentSheet(true)}
              className="flex items-center gap-1 text-xs font-semibold text-[#0891B2] cursor-pointer px-3 py-2 rounded-lg active:bg-[#ECFEFF] transition-colors"
              aria-haspopup="dialog"
              aria-label="تعديل طريقة الدفع"
            >
              <Pencil size={13} aria-hidden="true" />
              تعديل
            </button>
          </div>
        </Section>

        {/* Price summary */}
        <Section title="">
          <div className="px-4 py-4 space-y-3">
            <PriceLine label="المجموع" value={formatPrice(subtotal)} />
            {couponDiscount > 0 && (
              <PriceLine label={`كوبون ${couponCode}`} value={`-${formatPrice(couponDiscount)}`} valueClass="text-[#059669]" />
            )}
            <div className="h-px bg-gray-100" />
            <div className="flex justify-between">
              <span className="text-base font-bold text-[#164E63]">الإجمالي</span>
              <span className="text-base font-bold text-[#164E63]">{formatPrice(total)}</span>
            </div>
          </div>
        </Section>
      </div>

      <div className="md:hidden fixed bottom-0 start-0 end-0 px-4 pt-3 bg-white border-t border-gray-100 safe-bottom-md z-20">
        <div className="max-w-md mx-auto">
          <Button onClick={handleConfirm} loading={orderLoading} size="lg" className="w-full">
            تأكيد الطلب — {formatPrice(total)}
          </Button>
        </div>
      </div>
      <div className="hidden md:block px-4 md:px-6 pb-6">
        <Button onClick={handleConfirm} loading={orderLoading} size="lg" className="w-full md:w-auto md:px-12 md:ms-auto md:flex">
          تأكيد الطلب — {formatPrice(total)}
        </Button>
      </div>

      {/* Payment sheet */}
      <BottomSheet open={paymentSheet} onClose={() => setPaymentSheet(false)} title="طريقة الدفع">
        <div className="px-4 py-4 space-y-2">
          {([
            { value: "online" as PaymentMethod, Icon: CreditCard, iconClass: "text-[#0891B2]", label: "الدفع الإلكتروني", sub: "فيزا، ماستركارد" },
            { value: "cash" as PaymentMethod, Icon: Banknote, iconClass: "text-[#059669]", label: "الدفع عند الاستلام", sub: "نقداً عند وصول الممرض" },
          ]).map((opt) => (
            <motion.button
              key={opt.value}
              whileTap={{ scale: 0.97 }}
              onClick={() => choosePayment(opt.value)}
              aria-pressed={paymentMethod === opt.value}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-150 text-start ${paymentMethod === opt.value ? "border-[#0891B2] bg-[#ECFEFF]" : "border-gray-200 bg-white active:bg-gray-50"}`}
            >
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <opt.Icon size={19} className={opt.iconClass} aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#164E63]">{opt.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${paymentMethod === opt.value ? "border-[#0891B2] bg-[#0891B2]" : "border-gray-300"}`}>
                {paymentMethod === opt.value && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
            </motion.button>
          ))}
          <p className="text-[11px] text-gray-400 text-center pt-2">
            يتم حفظ اختيارك للطلبات القادمة. يمكنك تغييره في أي وقت.
          </p>
        </div>
      </BottomSheet>

      <BottomSheet open={!!removeSheet} onClose={() => setRemoveSheet(null)} title="حذف التحليل">
        <div className="px-4 py-4 space-y-4">
          <p className="text-sm text-gray-600 text-center leading-relaxed">
            هل تريد حذف &ldquo;{removeSheet?.nameAr}&rdquo; من السلة؟
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setRemoveSheet(null)} className="flex-1">إلغاء</Button>
            <Button variant="danger" onClick={() => { setLocalTests((prev) => prev.filter((t) => t.id !== removeSheet!.id)); setRemoveSheet(null); }} className="flex-1">
              حذف
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 mt-4">
      {title && <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h2>}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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

function PriceLine({ label, value, valueClass = "text-[#164E63]" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
