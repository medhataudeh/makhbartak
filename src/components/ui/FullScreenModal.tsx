"use client";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect } from "react";

interface FullScreenModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showBack?: boolean;
}

export function FullScreenModal({ open, onClose, title, children, showBack = true }: FullScreenModalProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="fullscreen"
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "-100%", opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 260 }}
          className="fixed inset-0 z-50 bg-white flex flex-col"
          style={{ maxWidth: "448px", margin: "0 auto" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white safe-top">
            {showBack && (
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center cursor-pointer"
                aria-label="رجوع"
              >
                <ArrowRight size={20} className="text-[#164E63]" />
              </button>
            )}
            {title && (
              <h2 className="text-lg font-semibold text-[#164E63] flex-1">{title}</h2>
            )}
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto scroll-smooth-touch">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
