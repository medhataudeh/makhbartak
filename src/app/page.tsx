"use client";
import { useState, useRef } from "react";
import { AnimatePresence } from "framer-motion";

import { LoginModal } from "@/components/auth/LoginModal";
import { BottomNav, type NavTab } from "@/components/layout/BottomNav";
import { SideNav } from "@/components/layout/SideNav";
import { HomeScreen } from "@/components/home/HomeScreen";
import { PackageDetails } from "@/components/home/PackageDetails";
import { CustomTestBuilder } from "@/components/home/CustomTestBuilder";
import { PrescriptionUploader } from "@/components/home/PrescriptionUploader";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { CartScreen } from "@/components/cart/CartScreen";
import { OrderSuccess } from "@/components/order/OrderSuccess";
import { OrdersList } from "@/components/order/OrdersList";
import { NotificationsScreen } from "@/components/notifications/NotificationsScreen";
import { AccountScreen } from "@/components/account/AccountScreen";
import { ShoppingCart, ChevronLeft } from "lucide-react";

import type { Test, Package, Shift, Address, Patient, PaymentMethod } from "@/lib/types";
import { useCustomerNotifications, createOrder } from "@/lib/store";
import { useSystemSettings } from "@/lib/system-settings";
import { COMMON_INSTRUCTIONS } from "@/lib/mock-data";
import { dedupeInstructions, generateOrderNumber } from "@/lib/order-utils";
import { useToast } from "@/components/ui/Toast";

type AppView =
  | "home"
  | "package-details"
  | "custom-builder"
  | "prescription"
  | "booking"
  | "cart"
  | "success"
  | "notifications"; // opened from header, not the bottom nav

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
}

export default function App() {
  // The app boots in guest mode. Browsing is unrestricted; protected actions
  // (add-to-cart, confirm order, account writes) call requireAuth(...) which
  // shows the login modal and replays the original action on success.
  const [authed, setAuthed] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState<string | undefined>(undefined);
  const pendingIntent = useRef<(() => void) | null>(null);
  const toast = useToast();

  const requireAuth = (action: () => void, reasonAr?: string) => {
    if (authed) { action(); return; }
    pendingIntent.current = action;
    setLoginReason(reasonAr);
    setLoginOpen(true);
  };

  const handleLoginSuccess = () => {
    setAuthed(true);
    setLoginOpen(false);
    toast.success("تم تسجيل الدخول");
    const next = pendingIntent.current;
    pendingIntent.current = null;
    if (next) next();
  };

  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [view, setView] = useState<AppView>("home");
  const [booking, setBooking] = useState<BookingState>({});
  const [pendingPackage, setPendingPackage] = useState<Package | null>(null);
  const [lastOrderPublicNumber, setLastOrderPublicNumber] = useState<string | null>(null);

  const unread = useCustomerNotifications().filter((n) => !n.isRead).length;
  const settings = useSystemSettings();

  const goHome = () => { setView("home"); setActiveTab("home"); };
  const openNotifications = () => setView("notifications");

  // Cart count: package = 1 line, custom/prescription = number of tests.
  const cartCount = booking.pkg ? 1 : (booking.tests?.length ?? 0);
  const hasCart = !!booking.pkg || (booking.tests?.length ?? 0) > 0;

  // Single confirm-purchase handler shared by both CartScreen mounts (cart
  // view and cart tab). Builds the order via createOrder() with idempotency.
  const confirmPurchase = (snapshot: import("@/components/cart/CartScreen").CartConfirmSnapshot) => {
    requireAuth(() => {
      const publicNumber = generateOrderNumber();
      const initialStatus =
        snapshot.paymentMethod === "cash" && settings.allowCashOrders
          ? "confirmed"
          : "created";
      createOrder({
        idempotencyKey: snapshot.idempotencyKey,
        userId: "u-1",
        type: snapshot.type,
        packageSnapshot: snapshot.packageSnapshot,
        packageNameAr: snapshot.packageNameAr,
        items: snapshot.items,
        subtotal: snapshot.subtotal,
        couponCode: snapshot.couponCode,
        couponDiscount: snapshot.couponDiscount,
        total: snapshot.total,
        shift: booking.shift!,
        visitDate: booking.visitDate ?? new Date().toISOString().split("T")[0],
        shiftStartTime: booking.shiftStartTime,
        shiftEndTime: booking.shiftEndTime,
        address: booking.address!,
        patient: booking.patient!,
        paymentMethod: snapshot.paymentMethod,
        paymentStatus: "pending",
        instructions: dedupeInstructions(COMMON_INSTRUCTIONS),
        publicNumber,
        initialStatus,
      });
      setLastOrderPublicNumber(publicNumber);
      setBooking((b) => ({ ...b, paymentMethod: snapshot.paymentMethod }));
      setView("success");
    }, "أكمل تسجيل الدخول لتأكيد الطلب.");
  };

  // Tab change. The "cart" tab opens the cart flow when there's something in
  // it, otherwise drops a friendly empty state in-line.
  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    if (tab === "cart") {
      // hasCart routes the renderer to either CartScreen or the empty state.
      setView("home");
      return;
    }
    setView("home");
  };

  const renderScreen = () => {
    // Header-opened notifications take precedence over tab content.
    if (view === "notifications") {
      return <NotificationsScreen />;
    }

    if (view === "home" || activeTab !== "home") {
      if (activeTab === "orders") {
        if (!authed) {
          return <GuestGate
            messageAr="سجّل الدخول لعرض طلباتك."
            onLogin={() => requireAuth(() => { /* stays on orders tab */ }, "سجّل الدخول لعرض طلباتك.")}
          />;
        }
        return <OrdersList onOpenNotifications={openNotifications} unreadNotifications={unread} />;
      }
      if (activeTab === "account") {
        if (!authed) {
          return <GuestGate
            messageAr="سجّل الدخول للوصول إلى حسابك."
            onLogin={() => requireAuth(() => { /* stays on account tab */ }, "سجّل الدخول للوصول إلى حسابك.")}
          />;
        }
        return <AccountScreen
          onLogout={() => { setAuthed(false); toast.success("تم تسجيل الخروج"); }}
          onDeleteAccount={() => {
            // Soft delete (prototype): clear local profile + return to guest.
            try {
              window.localStorage.removeItem("makhbartak.profile.patients.v1");
              window.localStorage.removeItem("makhbartak.profile.addresses.v1");
              window.localStorage.removeItem("makhbartak.payment.preferred");
            } catch {}
            setAuthed(false);
            setActiveTab("home");
            setView("home");
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
          // The user has tests/package picked but hasn't picked address/shift/patient
          // — bounce them into the booking flow to complete it.
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
            onAddToCart={(pkg) => requireAuth(
              () => { setBooking({ pkg }); setView("booking"); },
              "أكمل تسجيل الدخول لإضافة الباقة إلى السلة.",
            )}
          />
        );
      case "custom-builder":
        return (
          <CustomTestBuilder
            onContinue={(tests) => requireAuth(
              () => { setBooking({ tests }); setView("booking"); },
              "أكمل تسجيل الدخول لمتابعة الحجز.",
            )}
            onBack={goHome}
          />
        );
      case "prescription":
        return (
          <PrescriptionUploader
            onContinue={(tests) => requireAuth(
              () => { setBooking({ tests }); setView("booking"); },
              "أكمل تسجيل الدخول لمتابعة الحجز.",
            )}
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
    view === "notifications" ||
    view === "home" ||
    (activeTab !== "home" && view !== "success");

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

      <LoginModal
        open={loginOpen}
        reasonAr={loginReason}
        onClose={() => { setLoginOpen(false); pendingIntent.current = null; }}
        onSuccess={handleLoginSuccess}
      />
    </div>
  );
}

function GuestGate({ messageAr, onLogin }: { messageAr: string; onLogin: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center pb-24">
      <div className="w-20 h-20 rounded-2xl bg-[#ECFEFF] flex items-center justify-center mb-4">
        <ShoppingCart size={32} className="text-[#0891B2]" aria-hidden="true" />
      </div>
      <p className="text-base font-bold text-[#164E63]">يلزم تسجيل الدخول</p>
      <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{messageAr}</p>
      <button
        onClick={onLogin}
        className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-[#0891B2] text-white text-sm font-semibold cursor-pointer active:bg-[#0E7490]"
      >
        تسجيل الدخول
      </button>
      <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
        يمكنك أيضاً متابعة التصفح بدون تسجيل من تبويب &ldquo;الرئيسية&rdquo;.
      </p>
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
