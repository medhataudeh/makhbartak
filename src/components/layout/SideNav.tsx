"use client";
import { motion } from "framer-motion";
import { Home, ClipboardList, ShoppingCart, User, FlaskConical, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavTab } from "./BottomNav";

interface SideNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
  cartCount?: number;
  unreadNotifications?: number;
  onNotificationsClick?: () => void;
}

const tabs: { id: NavTab; labelAr: string; Icon: React.FC<{ size: number }> }[] = [
  { id: "home",    labelAr: "الرئيسية", Icon: Home },
  { id: "orders",  labelAr: "طلباتي",   Icon: ClipboardList },
  { id: "cart",    labelAr: "السلة",     Icon: ShoppingCart },
  { id: "account", labelAr: "حسابي",    Icon: User },
];

export function SideNav({ active, onChange, cartCount = 0, unreadNotifications = 0, onNotificationsClick }: SideNavProps) {
  return (
    <aside
      className="hidden md:flex md:flex-col w-60 lg:w-64 bg-white border-s border-gray-100 sticky top-0 h-screen flex-shrink-0"
      aria-label="التنقل الرئيسي"
    >
      {/* Brand */}
      <div className="px-5 py-6 border-b border-gray-100 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#ECFEFF] flex items-center justify-center">
          <FlaskConical size={20} className="text-[#0891B2]" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-[#164E63] leading-tight">مختبرك</p>
          <p className="text-[11px] text-gray-400 leading-tight">تحاليل من البيت</p>
        </div>
        {onNotificationsClick && (
          <button
            onClick={onNotificationsClick}
            aria-label={unreadNotifications > 0 ? `الإشعارات — ${unreadNotifications} غير مقروء` : "الإشعارات"}
            className="relative w-9 h-9 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center cursor-pointer flex-shrink-0"
          >
            <Bell size={16} className="text-[#164E63]" aria-hidden="true" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -end-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold cursor-pointer relative transition-colors",
                isActive
                  ? "bg-[#ECFEFF] text-[#0891B2]"
                  : "text-gray-500 hover:bg-gray-50 hover:text-[#164E63]"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="sidenav-active"
                  className="absolute inset-0 rounded-xl bg-[#ECFEFF] -z-10"
                  transition={{ type: "spring", damping: 28, stiffness: 320 }}
                />
              )}
              <div className="relative">
                <tab.Icon size={18} aria-hidden="true" />
                {tab.id === "cart" && cartCount > 0 && (
                  <span className="absolute -top-1.5 -end-1.5 min-w-[16px] h-4 bg-[#059669] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </div>
              <span>{tab.labelAr}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-100 text-[11px] text-gray-400 leading-relaxed">
        © {new Date().getFullYear()} مختبرك
      </div>
    </aside>
  );
}
