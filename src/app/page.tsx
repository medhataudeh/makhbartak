"use client";
import { useEffect, useRef, useState } from "react";
import { hydrateProfileForCustomer } from "@/lib/profile";
import { AnimatePresence } from "framer-motion";

import { CustomerLogin } from "@/components/auth/CustomerLogin";
import { AuthLoading } from "@/components/auth/AuthLoading";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { LogIn } from "lucide-react";
import { BottomNav, type NavTab } from "@/components/layout/BottomNav";
import { SideNav } from "@/components/layout/SideNav";
import { HomeScreen } from "@/components/home/HomeScreen";
import { PackageDetails } from "@/components/home/PackageDetails";
import { CustomTestBuilder } from "@/components/home/CustomTestBuilder";
import { PrescriptionUploader } from "@/components/home/PrescriptionUploader";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { CartScreen } from "@/components/cart/CartScreen";
import { OrderSuccess } from "@/components/order/OrderSuccess";
import { StripePaymentScreen } from "@/components/payment/StripePaymentScreen";
import { OrdersList } from "@/components/order/OrdersList";
import { NotificationsScreen } from "@/components/notifications/NotificationsScreen";
import { AccountScreen } from "@/components/account/AccountScreen";
import { ShoppingCart, ChevronLeft } from "lucide-react";

import type { Test, Package, Shift, Address, Patient, PaymentMethod } from "@/lib/types";
import { useCustomerNotifications, createOrder, useOrderByIdempotencyKey, hydrateNotificationsForCustomer, awaitOrderRemote, useOrders } from "@/lib/store";
import { COMMON_INSTRUCTIONS } from "@/lib/mock-data";
import { dedupeInstructions, generateOrderNumber } from "@/lib/order-utils";
import { useToast } from "@/components/ui/Toast";
import { useSession, useAuthStatus, logout } from "@/lib/auth";
import { useSystemSettings } from "@/lib/system-settings";

type AppView =
  | "home"
  | "package-details"
  | "custom-builder"
  | "prescription"
  | "booking"
  | "cart"
  | "payment"         // online checkout — Phase 4.4
  | "success"
  | "notifications"   // opened from header, not the bottom nav
  | "login";          // shown only when a transactional action requires it

interface BookingState {
  tests?: Test[];
  pkg?: Package;
  shift?: Shift;
  visitDate?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  address?: Address;
  patient?: Patient;
  paymentMethod?: PaymentMethod;
  /** Storage path returned by /api/customers/[id]/prescriptions when the
   *  customer chose the prescription flow. Forwarded to /api/orders. */
  prescriptionPath?: string;
}

export default function App() {
  // Guest browsing: home / sliders / package details / custom builder /
  // prescription / cart preview are all reachable without a session. Only
  // transactional intents (add to cart, checkout, save address, place order,
  // view my orders, account) gate on auth — see `requireLogin()` below.
  return <CustomerApp />;
}

function CustomerApp() {
  const toast = useToast();
  const session = useSession();
  const authStatus = useAuthStatus();
  // Customer-portal guard: a non-customer session (admin/lab/nurse) on `/`
  // shows the customer login screen instead of letting them browse the
  // customer shell with the wrong role. While the cookie is being verified
  // we treat as "not yet a customer" but render the regular browsing
  // surface (guest-allowed); only the gated tabs flip to a loader while
  // status === "loading".
  const isCustomer = !!session && session.role === "customer";
  const userId = isCustomer ? session.linkedEntityId : "";

  // Stage E: pull the canonical patients/addresses/payment pref before any
  // booking starts. Closes the placeholder-UUID race that used to make
  // /api/orders reject the create with an FK error. Skipped for guests.
  useEffect(() => {
    if (!userId) return;
    void hydrateProfileForCustomer(userId);
    void hydrateNotificationsForCustomer(userId);
  }, [userId]);
  // STORAGE POLICY: sessionStorage `makhbartak.customer.nav.v1` is a
  // UX hint only — preserves the active customer tab across hard refresh
  // within the same tab. NEVER used to persist business data; clearing it
  // resets only the navigation state. The auth session lives in cookies
  // and on the auth.users row, separate from this key.
  const NAV_KEY = "makhbartak.customer.nav.v1";
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    if (typeof window === "undefined") return "home";
    try {
      const raw = window.sessionStorage.getItem(NAV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tab?: NavTab };
        if (parsed.tab) return parsed.tab;
      }
    } catch {}
    return "home";
  });
  const [view, setView] = useState<AppView>(() => {
    if (typeof window === "undefined") return "home";
    try {
      const raw = window.sessionStorage.getItem(NAV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { view?: AppView };
        // Don't restore transient views — they require booking state we
        // never persist. Only the tabs the user can land on directly.
        if (parsed.view === "notifications") return "notifications";
      }
    } catch {}
    return "home";
  });
  // Single writer for the nav hint. The previous approach wrapped each setter
  // to also persist the OTHER field — but it read that field from a stale
  // closure, so tapping "home" from "account" wrote {tab:"account"} back to
  // storage and a refresh bounced the user to account. Persisting both fields
  // together from an effect always uses the committed render values. Transient
  // booking views collapse to "home" so a mid-booking refresh lands on a valid
  // screen rather than a broken view missing its in-memory booking state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const persistView: AppView = view === "notifications" ? "notifications" : "home";
    try {
      window.sessionStorage.setItem(NAV_KEY, JSON.stringify({ tab: activeTab, view: persistView }));
    } catch {}
  }, [activeTab, view]);
  const [booking, setBooking] = useState<BookingState>({});
  const [pendingPackage, setPendingPackage] = useState<Package | null>(null);
  const [lastIdempotencyKey, setLastIdempotencyKey] = useState<string | null>(null);
  // Where to send the user after they sign in via the inline login view.
  // We store it as a ref so the post-login effect doesn't rerun when the
  // pending action changes during the auth round-trip.
  const postLoginRef = useRef<(() => void) | null>(null);

  // Returns true if a transactional action may proceed; otherwise routes the
  // user to the inline login view. Pass an `onSuccess` to resume the action
  // automatically after the session arrives.
  const requireLogin = (onSuccess?: () => void): boolean => {
    if (isCustomer) return true;
    postLoginRef.current = onSuccess ?? null;
    setView("login");
    return false;
  };

  // Pop out of the login view as soon as a customer session lands and replay
  // the pending action. setState-in-effect is the right tool here: the
  // external state (Supabase auth session) just changed and we need to
  // mirror that into the local view router.
  useEffect(() => {
    if (!(isCustomer && view === "login")) return;
    const next = postLoginRef.current;
    postLoginRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView("home");
    if (next) next();
    // setView is a stable useState setter, so it needs no dep entry.
  }, [isCustomer, view]);
  // Live-tracked Order for the success screen. After the server swaps the
  // placeholder for the canonical UUID + server-generated public_number, this
  // hook re-renders with the server values.
  const lastOrder = useOrderByIdempotencyKey(lastIdempotencyKey);
  const lastOrderPublicNumber = lastOrder?.publicNumber ?? null;
  const systemSettings = useSystemSettings();
  // Phase 4.4 — when the customer hits "ادفع الآن" from OrdersList, we
  // route into the same StripePaymentScreen but against an existing order
  // (not the one we just created via cart).
  const [payOrderId, setPayOrderId] = useState<string | null>(null);
  const allOrders = useOrders();
  const payOrder = payOrderId ? allOrders.find((o) => o.id === payOrderId) ?? null : null;
  const activePayOrder = payOrder ?? lastOrder ?? null;

  const unread = useCustomerNotifications().filter((n) => !n.isRead).length;

  const goHome = () => { setView("home"); setActiveTab("home"); };
  const openNotifications = () => setView("notifications");

  // Cart count: package = 1 line, custom/prescription = number of tests.
  const cartCount = booking.pkg ? 1 : (booking.tests?.length ?? 0);
  const hasCart = !!booking.pkg || (booking.tests?.length ?? 0) > 0;

  const confirmPurchase = async (snapshot: import("@/components/cart/CartScreen").CartConfirmSnapshot) => {
    // Checkout is the hard auth gate: if the user reached the cart as a
    // guest somehow, send them through login first and replay the confirm
    // automatically. Without a session there's no `userId` to attach the
    // order to, and /api/orders POST would 401.
    if (!isCustomer) {
      requireLogin(() => { void confirmPurchase(snapshot); });
      return;
    }
    // Local placeholder for the optimistic in-memory order; the server
    // generates the canonical HL-YYYY-NNNNNN and the store swaps it in.
    const publicNumber = generateOrderNumber();
    // Always start in the pending bucket. Confirmation is an admin/system
    // action — see /api/orders/[id]/status. The previous cash-allowed branch
    // was effectively auto-confirming on the customer's behalf.
    const initialStatus = "created";
    createOrder({
      idempotencyKey: snapshot.idempotencyKey,
      userId,
      session: session ?? undefined,
      type: snapshot.type,
      packageSnapshot: snapshot.packageSnapshot,
      packageNameAr: snapshot.packageNameAr,
      items: snapshot.items,
      subtotal: snapshot.subtotal,
      couponCode: snapshot.couponCode,
      couponDiscount: snapshot.couponDiscount,
      total: snapshot.total,
      shift: booking.shift!,
      visitDate: booking.visitDate ?? (() => {
        // Local YYYY-MM-DD — toISOString() would convert to UTC and could
        // post-shift the date in any +UTC timezone near midnight.
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })(),
      shiftStartTime: booking.shiftStartTime,
      shiftEndTime: booking.shiftEndTime,
      address: booking.address!,
      patient: booking.patient!,
      paymentMethod: snapshot.paymentMethod,
      paymentStatus: "pending",
      instructions: dedupeInstructions(COMMON_INSTRUCTIONS),
      publicNumber,
      initialStatus,
      prescriptionUrl: booking.prescriptionPath,
    });
    setLastIdempotencyKey(snapshot.idempotencyKey);
    setBooking((b) => ({ ...b, paymentMethod: snapshot.paymentMethod }));
    // Wait for the server to confirm the order is fully hydrated before
    // navigating to the success screen. If the remote write fails, surface
    // the error and stay on cart so the user doesn't see a "success" state
    // for an order the backend never finished creating.
    const remote = await awaitOrderRemote(snapshot.idempotencyKey);
    if (!remote.ok) {
      toast.error(remote.error ?? "تعذر إتمام الطلب. حاول مرة أخرى.");
      return;
    }
    // Phase 4.4 — online orders go through the Stripe checkout screen
    // before showing success. The success view is gated on the webhook
    // flipping payment_status='paid'. Cash flow is unchanged.
    if (snapshot.paymentMethod === "online") {
      setView("payment");
      return;
    }
    setView("success");
  };

  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    if (tab === "cart") {
      // hasCart routes the renderer to either CartScreen or the empty state.
      setView("home");
      return;
    }
    setView("home");
  };

  const handleLogout = () => {
    logout();
    toast.success("تم تسجيل الخروج");
  };

  const renderScreen = () => {
    if (view === "login") {
      return (
        <div className="min-h-screen bg-app">
          <div className="max-w-md mx-auto px-4 pt-3">
            <BackButton onClick={() => setView("home")} />
          </div>
          <CustomerLogin />
        </div>
      );
    }
    if (view === "notifications") {
      return <NotificationsScreen />;
    }

    if (view === "home" || activeTab !== "home") {
      if (activeTab === "orders") {
        if (authStatus === "loading") return <AuthLoading />;
        if (!isCustomer) {
          return <GuestGate
            titleAr="سجّل دخولك لعرض طلباتك"
            bodyAr="نحفظ سجل طلباتك وحالة كل زيارة بعد تسجيل الدخول."
            onLogin={() => setView("login")}
          />;
        }
        return (
          <OrdersList
            onOpenNotifications={openNotifications}
            unreadNotifications={unread}
            onPayOnline={(orderId) => { setPayOrderId(orderId); setView("payment"); }}
          />
        );
      }
      if (activeTab === "account") {
        if (authStatus === "loading") return <AuthLoading />;
        if (!isCustomer) {
          return <GuestGate
            titleAr="سجّل دخولك لإدارة حسابك"
            bodyAr="عناوينك ومرضاك وطرق الدفع تُحفظ بعد تسجيل الدخول."
            onLogin={() => setView("login")}
          />;
        }
        return <AccountScreen
          onLogout={handleLogout}
          onDeleteAccount={() => {
            // Soft-delete UI is a prototype hold-over; the real account
            // deletion endpoint is a Phase 3+ ticket. We only sign the
            // user out here so local memory clears.
            logout();
            toast.success("تم حذف حسابك");
          }}
        />;
      }
      if (activeTab === "cart") {
        if (hasCart && booking.shift && booking.address && booking.patient) {
          return (
            <CartScreen
              tests={booking.tests}
              pkg={booking.pkg}
              shift={booking.shift}
              address={booking.address}
              patient={booking.patient}
              onConfirm={confirmPurchase}
              onBack={() => { setActiveTab("home"); setView("home"); }}
            />
          );
        }
        if (hasCart) {
          return (
            <BookingFlow
              tests={booking.tests}
              pkg={booking.pkg}
              onContinue={({ shift, visitDate, shiftStartTime, shiftEndTime, address, patient }) => {
                setBooking((b) => ({ ...b, shift, visitDate, shiftStartTime, shiftEndTime, address, patient }));
                setView("cart");
              }}
              onBack={() => { setActiveTab("home"); setView("home"); }}
            />
          );
        }
        return <CartEmpty onShop={() => { setActiveTab("home"); setView("home"); }} />;
      }
    }

    switch (view) {
      case "package-details":
        if (!pendingPackage) { goHome(); return null; }
        return (
          <PackageDetails
            pkg={pendingPackage}
            onBack={goHome}
            onAddToCart={(pkg) => {
              if (!requireLogin(() => { setBooking({ pkg }); setView("booking"); })) return;
              setBooking({ pkg }); setView("booking");
            }}
          />
        );
      case "custom-builder":
        return (
          <CustomTestBuilder
            onContinue={(tests) => {
              if (!requireLogin(() => { setBooking({ tests }); setView("booking"); })) return;
              setBooking({ tests }); setView("booking");
            }}
            onBack={goHome}
          />
        );
      case "prescription":
        return (
          <PrescriptionUploader
            onContinue={({ tests, prescriptionPath }) => {
              if (!requireLogin(() => { setBooking({ tests, prescriptionPath }); setView("booking"); })) return;
              setBooking({ tests, prescriptionPath }); setView("booking");
            }}
            onBack={goHome}
          />
        );
      case "booking":
        return (
          <BookingFlow
            tests={booking.tests}
            pkg={booking.pkg}
            onContinue={({ shift, visitDate, shiftStartTime, shiftEndTime, address, patient }) => {
              setBooking((b) => ({ ...b, shift, visitDate, shiftStartTime, shiftEndTime, address, patient }));
              setView("cart");
            }}
            onBack={() => setView(booking.pkg ? "package-details" : "home")}
          />
        );
      case "cart":
        return (
          <CartScreen
            tests={booking.tests}
            pkg={booking.pkg}
            shift={booking.shift!}
            address={booking.address!}
            patient={booking.patient!}
            onConfirm={confirmPurchase}
            onBack={() => setView("booking")}
          />
        );
      case "payment":
        // Phase 4.4 — online checkout. The webhook is the only path that
        // flips payment_status='paid'; this screen polls until that
        // happens, then transitions to success.
        if (!activePayOrder?.id) {
          // Defensive — should be unreachable because we wait for the
          // server hydrate before entering this view.
          setView("home");
          return null;
        }
        return (
          <StripePaymentScreen
            orderId={activePayOrder.id}
            orderTotalSyp={activePayOrder.total ?? 0}
            publicNumber={activePayOrder.publicNumber ?? null}
            allowCash={!!systemSettings.allowCashOrders}
            onPaid={() => {
              // From cart → success screen; from OrdersList → back to orders.
              setPayOrderId(null);
              if (payOrder) {
                setActiveTab("orders"); setView("home");
              } else {
                setView("success");
              }
            }}
            onBack={() => {
              setPayOrderId(null);
              setActiveTab("orders"); setView("home");
              setBooking({}); setPendingPackage(null);
            }}
          />
        );
      case "success":
        return (
          <OrderSuccess
            orderId={lastOrderPublicNumber ?? "—"}
            onViewOrder={() => {
              setActiveTab("orders"); setView("home");
              setBooking({}); setPendingPackage(null);
            }}
            onShare={() => {
              if (typeof navigator !== "undefined" && navigator.share) {
                navigator.share({ title: "مختبرك", text: "تعليمات التحضير للتحاليل", url: window.location.href });
              }
            }}
          />
        );
      default:
        return (
          <HomeScreen
            onSelectPackage={(pkg) => { setPendingPackage(pkg); setView("package-details"); }}
            onPrescription={() => setView("prescription")}
            onCustomBuilder={() => setView("custom-builder")}
            cartCount={cartCount}
            onCartClick={() => { setActiveTab("cart"); setView("home"); }}
            onNotificationsClick={openNotifications}
            unreadNotifications={unread}
          />
        );
    }
  };

  const showNav =
    view !== "login" && view !== "payment" && (
      view === "notifications" ||
      view === "home" ||
      (activeTab !== "home" && view !== "success")
    );

  return (
    <div className="flex min-h-screen bg-app">
      {showNav && (
        <SideNav
          active={activeTab}
          onChange={handleTabChange}
          cartCount={cartCount}
          unreadNotifications={unread}
          onNotificationsClick={openNotifications}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 max-w-md md:max-w-none mx-auto md:mx-0 w-full md:w-auto">
          {renderScreen()}
        </div>

        <AnimatePresence>
          {showNav && (
            <BottomNav
              active={activeTab}
              onChange={handleTabChange}
              cartCount={cartCount}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function GuestGate({ titleAr, bodyAr, onLogin }: { titleAr: string; bodyAr: string; onLogin: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center pb-24">
      <div className="w-20 h-20 rounded-2xl bg-[#ECFEFF] flex items-center justify-center mb-4">
        <LogIn size={32} className="text-[#0891B2]" aria-hidden="true" />
      </div>
      <p className="text-base font-bold text-[#164E63]">{titleAr}</p>
      <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-xs">{bodyAr}</p>
      <Button variant="primary" size="lg" className="mt-5" onClick={onLogin}>
        تسجيل الدخول
      </Button>
    </div>
  );
}

function CartEmpty({ onShop }: { onShop: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center pb-24">
      <div className="w-20 h-20 rounded-2xl bg-[#ECFEFF] flex items-center justify-center mb-4">
        <ShoppingCart size={32} className="text-[#0891B2]" aria-hidden="true" />
      </div>
      <p className="text-base font-bold text-[#164E63]">السلة فارغة</p>
      <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
        ابدأ بإضافة تحاليلك أو باقتك من الرئيسية.
      </p>
      <button
        onClick={onShop}
        className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer active:bg-[#0E7490]"
      >
        تصفّح الباقات
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
