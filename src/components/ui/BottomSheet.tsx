"use client";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-40"
            style={{ maxWidth: "448px", margin: "0 auto" }}
          />
          <motion.div
            key="sheet"
            ref={sheetRef}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) onClose();
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320, mass: 0.8 }}
            className="fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl overflow-hidden"
            style={{ maxWidth: "448px", margin: "0 auto" }}
          >
            {/* Drag handle — only this area initiates drag */}
            <div
              className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="w-9 h-1 rounded-full bg-gray-200" />
            </div>

            {title && (
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <h3 className="text-[15px] font-semibold text-[#164E63]">{title}</h3>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center cursor-pointer transition-colors active:bg-gray-200"
                  aria-label="إغلاق"
                >
                  <X size={15} className="text-gray-500" aria-hidden="true" />
                </button>
              </div>
            )}

            <div className="overflow-y-auto" style={{ maxHeight: "75vh" }}>
              {children}
            </div>
            {/* iOS safe area — small base so non-notched still gets a tidy
               gap below the last sheet row. */}
            <div className="safe-bottom-sm" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
