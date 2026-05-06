"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, ShieldCheck, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/Button";
import { BackButton } from "@/components/ui/BackButton";
import { useToast } from "@/components/ui/Toast";
import { formatPrice } from "@/lib/utils";
import { useSystemSettings } from "@/lib/system-settings";
import { apiCreateStripeIntent, apiGetOrderPaymentState, type OrderPaymentState } from "@/lib/orders-api";

// Phase 4.4 — customer-facing online payment screen.
//
// State machine:
//   loading_intent → ready (Elements mounted) → submitting (confirm) →
//     processing (poll for webhook) → paid | failed
//
// Webhook is the source of truth. Stripe's client confirm only tells us the
// charge was authorized; we wait until the server-side `payments.status`
// flips to `verified_by_admin` AND `orders.payment_status='paid'` before
// declaring success.

interface Props {
  orderId: string;
  orderTotalSyp: number;
  publicNumber?: string | null;
  /** Called once webhook confirms the payment. */
  onPaid: () => void;
  /** Customer wants to back out — return to OrderDetails. */
  onBack: () => void;
  /** Customer chose "switch to cash" — only available when allowCashOrders. */
  onSwitchToCash?: () => void | Promise<void>;
  allowCash?: boolean;
}

export function StripePaymentScreen({
  orderId, orderTotalSyp, publicNumber, onPaid, onBack, onSwitchToCash, allowCash,
}: Props) {
  const settings = useSystemSettings();
  const publicKey = settings.stripePublicKey?.trim() || "";

  // Stripe.js handle: lazily resolved once per public key. Computed at
  // render time (not in an effect) so we don't trigger the cascading-render
  // lint warning. loadStripe itself is memoized by Stripe under the hood.
  const [stripeKey, setStripeKey] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  if (publicKey && stripeKey !== publicKey) {
    setStripeKey(publicKey);
    setStripePromise(loadStripe(publicKey));
  }

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentMeta, setIntentMeta] = useState<{ providerCurrency?: string; chargedAmount?: number; exchangeRate?: number } | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [intentLoading, setIntentLoading] = useState(true);

  // Manual retry handler used by the "إعادة المحاولة" button.
  const createIntent = useCallback(async () => {
    setIntentLoading(true);
    setIntentError(null);
    const r = await apiCreateStripeIntent(orderId);
    setIntentLoading(false);
    if (!r.ok) { setIntentError(r.error); return; }
    setClientSecret(r.intent.clientSecret);
    setIntentMeta({
      providerCurrency: r.intent.providerCurrency,
      chargedAmount:    r.intent.chargedAmount,
      exchangeRate:     r.intent.exchangeRate,
    });
  }, [orderId]);

  // Create the PaymentIntent on mount / when orderId changes. The async IIFE
  // pattern is what other panes in this app use; the lint rule allows it.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const r = await apiCreateStripeIntent(orderId);
      if (ctrl.signal.aborted) return;
      if (!r.ok) {
        setIntentError(r.error);
        setIntentLoading(false);
        return;
      }
      setClientSecret(r.intent.clientSecret);
      setIntentMeta({
        providerCurrency: r.intent.providerCurrency,
        chargedAmount:    r.intent.chargedAmount,
        exchangeRate:     r.intent.exchangeRate,
      });
      setIntentLoading(false);
    })();
    return () => ctrl.abort();
  }, [orderId]);

  if (!publicKey) {
    return (
      <PaymentShell onBack={onBack} title="الدفع الإلكتروني">
        <ErrorBox
          title="الدفع الإلكتروني غير متاح حالياً"
          body="حدث خطأ في إعداد الدفع الإلكتروني. الرجاء العودة واختيار الدفع نقداً أو المحاولة لاحقاً."
        />
        {/* publicKey absent is an admin/config issue — surface in console only. */}
        {typeof window !== "undefined" && (() => { console.warn("[StripePaymentScreen] stripe_public_key missing in app_settings"); return null; })()}
        {allowCash && onSwitchToCash && (
          <Button size="lg" variant="outline" className="w-full mt-3" onClick={onSwitchToCash}>
            تحويل إلى الدفع نقداً
          </Button>
        )}
      </PaymentShell>
    );
  }

  if (intentLoading) {
    return (
      <PaymentShell onBack={onBack} title="الدفع الإلكتروني">
        <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-3">
          <Loader2 size={28} className="animate-spin text-[#0891B2]" aria-hidden="true" />
          <p className="text-sm">جاري تجهيز الدفع…</p>
        </div>
      </PaymentShell>
    );
  }

  if (intentError || !clientSecret) {
    return (
      <PaymentShell onBack={onBack} title="الدفع الإلكتروني">
        <ErrorBox
          title="تعذر بدء عملية الدفع"
          body={intentError ?? "حدث خطأ غير متوقع. حاول مرة أخرى."}
        />
        <Button size="lg" variant="primary" className="w-full mt-3" onClick={() => void createIntent()}>
          إعادة المحاولة
        </Button>
        {allowCash && onSwitchToCash && (
          <Button size="lg" variant="outline" className="w-full mt-2" onClick={onSwitchToCash}>
            تحويل إلى الدفع نقداً
          </Button>
        )}
      </PaymentShell>
    );
  }

  return (
    <PaymentShell onBack={onBack} title="الدفع الإلكتروني">
      <SummaryCard
        publicNumber={publicNumber ?? null}
        amountSyp={orderTotalSyp}
        chargedAmount={intentMeta?.chargedAmount}
        providerCurrency={intentMeta?.providerCurrency}
        exchangeRate={intentMeta?.exchangeRate}
      />
      <Elements stripe={stripePromise} options={{ clientSecret, locale: "ar" }}>
        <CheckoutForm
          orderId={orderId}
          onPaid={onPaid}
          onSwitchToCash={onSwitchToCash}
          allowCash={!!allowCash}
        />
      </Elements>
    </PaymentShell>
  );
}

// ─── Inner form (must be inside <Elements>) ─────────────────────────────────

function CheckoutForm({
  orderId, onPaid, onSwitchToCash, allowCash,
}: {
  orderId: string;
  onPaid: () => void;
  onSwitchToCash?: () => void | Promise<void>;
  allowCash: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const toast = useToast();

  type Phase = "ready" | "submitting" | "processing" | "paid" | "failed";
  const [phase, setPhase] = useState<Phase>("ready");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Cleanup poller on unmount.
  useEffect(() => {
    return () => { if (pollRef.current) window.clearTimeout(pollRef.current); };
  }, []);

  const startPolling = () => {
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      const res = await apiGetOrderPaymentState(orderId);
      if (res.ok) {
        const ok = isFinalPaid(res.state);
        if (ok) {
          setPhase("paid");
          onPaid();
          return;
        }
        if (res.state.payment?.status === "failed") {
          setPhase("failed");
          setErrorMsg("فشل الدفع. حاول مرة أخرى.");
          return;
        }
      }
      // Up to ~60s of polling at 2s intervals — that's well past Stripe's
      // typical webhook latency. After that we give up and let the customer
      // refresh.
      if (attempts > 30) {
        setPhase("failed");
        setErrorMsg("لم نتلقَّ تأكيد الدفع من المزود بعد. يمكنك الانتظار قليلاً ثم إعادة تحميل الصفحة.");
        return;
      }
      pollRef.current = window.setTimeout(() => void tick(), 2000);
    };
    pollRef.current = window.setTimeout(() => void tick(), 1500);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (phase === "submitting" || phase === "processing") return;

    setPhase("submitting");
    setErrorMsg(null);

    // Confirm via the Stripe Elements API. We DO NOT mark the order paid
    // here — only the webhook can do that. Frontend success only triggers
    // the polling phase.
    const { error } = await confirmWithStripe(stripe, elements);
    if (error) {
      setPhase("failed");
      setErrorMsg(error);
      return;
    }
    setPhase("processing");
    toast.success("تم استلام الدفع، جاري التأكيد…");
    startPolling();
  };

  if (phase === "paid") {
    return (
      <SuccessBox title="تم الدفع بنجاح" body="جاري إعادتك إلى تفاصيل الطلب." />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement />
      {errorMsg && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-3">
          {errorMsg}
        </p>
      )}
      {phase === "processing" && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          <span>جاري تأكيد الدفع مع المزود…</span>
        </div>
      )}
      <Button
        size="lg" variant="primary" className="w-full" type="submit"
        loading={phase === "submitting" || phase === "processing"}
        disabled={!stripe || !elements || phase === "processing"}
      >
        <CreditCard size={15} aria-hidden="true" /> ادفع الآن
      </Button>
      {phase === "failed" && (
        <Button
          size="lg" variant="outline" className="w-full" type="button"
          onClick={() => { setPhase("ready"); setErrorMsg(null); }}
        >
          إعادة المحاولة
        </Button>
      )}
      {allowCash && onSwitchToCash && phase !== "submitting" && phase !== "processing" && (
        <Button size="lg" variant="ghost" className="w-full" type="button" onClick={onSwitchToCash}>
          تحويل إلى الدفع نقداً
        </Button>
      )}
      <p className="text-[11px] text-gray-400 text-center inline-flex items-center gap-1.5 justify-center w-full">
        <ShieldCheck size={12} aria-hidden="true" /> الدفع آمن ومُشفَّر عبر Stripe
      </p>
    </form>
  );
}

async function confirmWithStripe(
  stripe: Stripe, elements: StripeElements,
): Promise<{ error?: string }> {
  // We stay on this page (redirect: "if_required") so the success path is
  // the polling phase. Stripe will only redirect when a method like 3DS
  // forces it; in that case the customer returns to the same URL and the
  // page re-mounts in `processing` if the webhook arrived first.
  const result = await stripe.confirmPayment({
    elements,
    redirect: "if_required",
    confirmParams: {
      // The current page is fine — we'll re-enter and resume from
      // payment_status.
      return_url: typeof window !== "undefined" ? window.location.href : "",
    },
  });
  if (result.error) {
    return { error: result.error.message ?? "حدث خطأ أثناء معالجة الدفع" };
  }
  return {};
}

function isFinalPaid(state: OrderPaymentState): boolean {
  return state.order.paymentStatus === "paid"
    && (state.payment?.status === "verified_by_admin" || state.payment?.status === "paid");
}

// ─── Bits ───────────────────────────────────────────────────────────────────

function PaymentShell({ onBack, title, children }: { onBack: () => void; title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-40 bg-app flex flex-col"
      style={{ maxWidth: "448px", margin: "0 auto" }}
    >
      <header className="px-4 pt-5 pb-3 bg-white border-b border-gray-100 flex items-center gap-3">
        <BackButton onClick={onBack} aria-label="رجوع" />
        <h1 className="text-base font-bold text-[#164E63]">{title}</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-nav space-y-4">
        {children}
      </div>
    </motion.div>
  );
}

function SummaryCard({ publicNumber, amountSyp, chargedAmount, providerCurrency, exchangeRate }: {
  publicNumber: string | null;
  amountSyp: number;
  chargedAmount?: number;
  providerCurrency?: string;
  exchangeRate?: number;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
      <p className="text-[11px] text-gray-400">الطلب</p>
      <p className="text-base font-bold text-[#164E63] lat" dir="ltr">{publicNumber ?? "—"}</p>
      <div className="flex items-end justify-between pt-2 border-t border-gray-100">
        <div>
          <p className="text-[11px] text-gray-400">إجمالي الطلب</p>
          <p className="text-lg font-bold text-[#164E63]">{formatPrice(amountSyp)}</p>
        </div>
        {chargedAmount !== undefined && providerCurrency && (
          <div className="text-end">
            <p className="text-[11px] text-gray-400">سيُخصم</p>
            <p className="text-sm font-bold text-[#0891B2] lat" dir="ltr">
              {chargedAmount.toFixed(2)} {providerCurrency}
            </p>
          </div>
        )}
      </div>
      {exchangeRate && (
        <p className="text-[11px] text-gray-400">
          سعر الصرف: <span className="lat" dir="ltr">1 {providerCurrency} = {exchangeRate.toLocaleString("ar-SY")} ل.س</span>
        </p>
      )}
    </div>
  );
}

function ErrorBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 flex items-start gap-3">
      <AlertCircle size={18} className="text-rose-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-rose-800">{title}</p>
        <p className="text-xs text-rose-700 mt-1 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function SuccessBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 flex flex-col items-center text-center gap-2">
      <CheckCircle2 size={32} className="text-emerald-600" aria-hidden="true" />
      <p className="text-base font-bold text-emerald-800">{title}</p>
      <p className="text-xs text-emerald-700">{body}</p>
    </div>
  );
}
