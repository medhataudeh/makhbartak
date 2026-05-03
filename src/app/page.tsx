"use client";
import { useEffect, useState } from "react";
import { hydrateProfileForCustomer } from "@/lib/profile";
import { AnimatePresence } from "framer-motion";

import { CustomerLogin } from "@/components/auth/CustomerLogin";
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
import { useCustomerNotifications, createOrder, useOrderByIdempotencyKey, hydrateNotificationsForCustomer, awaitOrderRemote } from "@/lib/store";
import { useSystemSettings } from "@/lib/system-settings";
import { COMMON_INSTRUCTIONS } from "@/lib/mock-data";
import { dedupeInstructions, generateOrderNumber } from "@/lib/order-utils";
import { useToast } from "@/components/ui/Toast";
import { useSession, logout } from "@/lib/auth";

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
  const session = useSession();
  if (!session || session.role !== "customer") return <CustomerLogin />;
  return <CustomerApp userId={session.linkedEntityId} />;
}

function CustomerApp({ userId }: { userId: string }) {
  const toast = useToast();
  const session = useSession();
  // Stage E: pull the canonical patients/addresses/payment pref before any
  // booking starts. Closes the placeholder-UUID race that used to make
  // /api/orders reject the create with an FK error.
  useEffect(() => {
    void hydrateProfileForCustomer(userId);
    void hydrateNotificationsForCustomer(userId);
  }, [userId]);
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [view, setView] = useState<AppView>("home");
  const [booking, setBooking] = useState<BookingState>({});
  const [pendingPackage, setPendingPackage] = useState<Package | null>(null);
  const [lastIdempotencyKey, setLastIdempotencyKey] = useState<string | null>(null);
  // Live-tracked Order for the success screen. After the server swaps the
  // placeholder for the canonical UUID + server-generated public_number, this
  // hook re-renders with the server values.
  const lastOrder = useOrderByIdempotencyKey(lastIdempotencyKey);
  const lastOrderPublicNumber = lastOrder?.publicNumber ?? null;

  const unread = useCustomerNotifications().filter((n) => !n.isRead).length;
  const settings = useSystemSettings();

  const goHome = () => { setView("home"); setActiveTab("home"); };
  const openNotifications = () => setView("notifications");

  // Cart count: package = 1 line, custom/prescription = number of tests.
  const cartCount = booking.pkg ? 1 : (booking.tests?.length ?? 0);
  const hasCart = !!booking.pkg || (booking.tests?.length ?? 0) > 0;

  const confirmPurchase = async (snapshot: import("@/components/cart/CartScreen").CartConfirmSnapshot) => {
    // Local placeholder for the optimistic in-memory order; the server
    // generates the canonical HL-YYYY-NNNNNN and the store swaps it in.
    const publicNumber = generateOrderNumber();
    const initialStatus =
      snapshot.paymentMethod === "cash" && settings.allowCashOrders
        ? "confirmed"
        : "created";
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
    if (view === "notifications") {
      return <NotificationsScreen />;
    }

    if (view === "home" || activeTab !== "home") {
      if (activeTab === "orders") {
        return <OrdersList onOpenNotifications={openNotifications} unreadNotifications={unread} />;
      }
      if (activeTab === "account") {
        return <AccountScreen
          onLogout={handleLogout}
          onDeleteAccount={() => {
            // Soft delete (prototype): clear local profile + log out.
            try {
              window.localStorage.removeItem("makhbartak.profile.patients.v1");
              window.localStorage.removeItem("makhbartak.profile.addresses.v1");
              window.localStorage.removeItem("makhbartak.payment.preferred");
            } catch {}
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
            onAddToCart={(pkg) => { setBooking({ pkg }); setView("booking"); }}
          />
        );
      case "custom-builder":
        return (
          <CustomTestBuilder
            onContinue={(tests) => { setBooking({ tests }); setView("booking"); }}
            onBack={goHome}
          />
        );
      case "prescription":
        return (
          <PrescriptionUploader
            onContinue={(tests) => { setBooking({ tests }); setView("booking"); }}
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
