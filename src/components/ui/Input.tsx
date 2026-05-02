import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, startIcon, endIcon, className, id, ...props }, ref) => {
    const inputId = id || label;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-[#164E63]">
            {label}
          </label>
        )}
        <div className="relative">
          {startIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {startIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full h-12 px-4 rounded-xl border bg-white text-[#164E63]",
              "text-base placeholder:text-gray-400",
              "transition-all duration-200 outline-none",
              "border-gray-200 focus:border-[#0891B2] focus:ring-2 focus:ring-[#0891B2]/20",
              error && "border-red-400 focus:border-red-400 focus:ring-red-400/20",
              startIcon && "pr-10",
              endIcon && "pl-10",
              className
            )}
            {...props}
          />
          {endIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {endIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
