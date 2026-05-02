"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, Loader2, X } from "lucide-react";

export type ToastKind = "success" | "error" | "warning" | "info" | "loading";

interface ToastInput {
  kind?: ToastKind;
  message: string;
  /** Auto-dismiss after ms. Default 3000 (5000 for errors). 0 disables. */
  duration?: number;
}

interface Toast extends Required<Pick<ToastInput, "message">> {
  id: string;
  kind: ToastKind;
  duration: number;
}

interface ToastApi {
  show: (t: ToastInput) => string;
  success: (msg: string, duration?: number) => string;
  error: (msg: string, duration?: number) => string;
  info: (msg: string, duration?: number) => string;
  warning: (msg: string, duration?: number) => string;
  loading: (msg: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLES: Record<ToastKind, { bg: string; iconColor: string; Icon: React.FC<{ size?: number; className?: string }> }> = {
  success: { bg: "bg-emerald-50  border-emerald-200 text-emerald-800", iconColor: "text-emerald-600", Icon: CheckCircle2 },
  error:   { bg: "bg-red-50      border-red-200      text-red-800",     iconColor: "text-red-600",     Icon: AlertCircle },
  warning: { bg: "bg-amber-50    border-amber-200    text-amber-800",   iconColor: "text-amber-600",   Icon: AlertTriangle },
  info:    { bg: "bg-cyan-50     border-cyan-200     text-cyan-900",    iconColor: "text-cyan-600",    Icon: Info },
  loading: { bg: "bg-white       border-gray-200     text-[#164E63]",   iconColor: "text-[#0891B2]",   Icon: Loader2 },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: ToastInput): string => {
    const id = `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    const kind = input.kind ?? "info";
    const duration = input.duration ?? (kind === "error" ? 5000 : kind === "loading" ? 0 : 3000);
    setToasts((prev) => [...prev, { id, kind, message: input.message, duration }]);
    return id;
  }, []);

  const api: ToastApi = {
    show,
    success: (msg, d) => show({ kind: "success", message: msg, duration: d }),
    error:   (msg, d) => show({ kind: "error",   message: msg, duration: d }),
    info:    (msg, d) => show({ kind: "info",    message: msg, duration: d }),
    warning: (msg, d) => show({ kind: "warning", message: msg, duration: d }),
    loading: (msg)    => show({ kind: "loading", message: msg, duration: 0 }),
    dismiss,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      role="region" aria-label="إشعارات النظام" aria-live="polite"
      className="fixed top-3 start-3 z-[100] flex flex-col gap-2 pointer-events-none"
      style={{ maxWidth: "min(360px, calc(100vw - 24px))" }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { Icon, bg, iconColor } = KIND_STYLES[toast.kind];

  useEffect(() => {
    if (toast.duration <= 0) return;
    const id = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(id);
  }, [toast.duration, toast.id, onDismiss]);

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, x: -20, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -20, scale: 0.96 }}
      transition={{ type: "spring", damping: 26, stiffness: 320 }}
      className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 rounded-xl border shadow-[0_8px_24px_rgba(0,0,0,0.08)] ${bg}`}
    >
      <Icon
        size={17}
        className={`${iconColor} flex-shrink-0 mt-0.5 ${toast.kind === "loading" ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      <p className="flex-1 text-sm leading-snug">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="إغلاق الإشعار"
        className="w-6 h-6 rounded-md hover:bg-black/5 flex items-center justify-center cursor-pointer flex-shrink-0"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: log + no-op so a missing provider doesn't crash a screen.
    return {
      show:    ({ message }) => { console.warn("[toast no provider]", message); return ""; },
      success: (m) => { console.warn("[toast no provider]", m); return ""; },
      error:   (m) => { console.warn("[toast no provider]", m); return ""; },
      info:    (m) => { console.warn("[toast no provider]", m); return ""; },
      warning: (m) => { console.warn("[toast no provider]", m); return ""; },
      loading: (m) => { console.warn("[toast no provider]", m); return ""; },
      dismiss: () => {},
    };
  }
  return ctx;
}
