"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[#059669] text-white shadow-[0_2px_8px_rgba(5,150,105,0.28)] active:shadow-none active:bg-[#047857]",
  secondary: "bg-[#0891B2] text-white shadow-[0_2px_8px_rgba(8,145,178,0.22)] active:shadow-none active:bg-[#0E7490]",
  ghost: "bg-transparent text-[#0891B2] active:bg-[#ECFEFF]",
  danger: "bg-red-500 text-white active:bg-red-600",
  outline: "bg-white border-2 border-[#0891B2] text-[#0891B2] active:bg-[#ECFEFF]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm rounded-xl",
  md: "h-12 px-5 text-base rounded-2xl",
  lg: "h-14 px-6 text-[17px] rounded-2xl font-semibold",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  onClick,
  type = "button",
  "aria-label": ariaLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      type={type}
      whileTap={{ scale: isDisabled ? 1 : 0.97 }}
      transition={{ duration: 0.1 }}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium cursor-pointer",
        "transition-colors duration-150 select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
      {children}
    </motion.button>
  );
}
