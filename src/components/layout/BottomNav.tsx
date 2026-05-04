"use client";
import { motion } from "framer-motion";
import { Home, ClipboardList, ShoppingCart, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavTab = "home" | "orders" | "cart" | "account";

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
  cartCount?: number;
}

const tabs: { id: NavTab; labelAr: string; Icon: React.FC<{ size: number }> }[] = [
  { id: "home",    labelAr: "الرئيسية", Icon: Home },
  { id: "orders",  labelAr: "طلباتي",   Icon: ClipboardList },
  { id: "cart",    labelAr: "السلة",     Icon: ShoppingCart },
  { id: "account", labelAr: "حسابي",    Icon: User },
];

export function BottomNav({ active, onChange, cartCount = 0 }: BottomNavProps) {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 safe-bottom-sm"
      aria-label="التنقل الرئيسي"
    >
      <div className="flex items-stretch h-16">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              aria-label={tab.labelAr}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 relative cursor-pointer",
                "transition-colors duration-150",
                isActive ? "text-[#0891B2]" : "text-gray-400"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute top-0 inset-x-3 h-0.5 bg-[#0891B2] rounded-full"
                  transition={{ type: "spring", damping: 28, stiffness: 320 }}
                />
              )}

              <div className="relative">
                <tab.Icon size={22} aria-hidden="true" />
                {tab.id === "cart" && cartCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 15 }}
                    className="absolute -top-1.5 -end-1.5 min-w-[16px] h-4 bg-[#059669] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1"
                    aria-label={`السلة — ${cartCount} عنصر`}
                  >
                    {cartCount > 9 ? "9+" : cartCount}
                  </motion.span>
                )}
              </div>

              <span className="text-[11px] font-medium leading-none">{tab.labelAr}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
