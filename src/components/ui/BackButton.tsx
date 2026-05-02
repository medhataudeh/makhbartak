import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  onClick: () => void;
  className?: string;
  "aria-label"?: string;
}

// In RTL layout, "go back" points right (→). Use ChevronRight directly.
export function BackButton({ onClick, className, "aria-label": label = "رجوع" }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center cursor-pointer",
        "transition-colors duration-150 active:bg-gray-200",
        className
      )}
    >
      <ChevronRight size={20} className="text-[#164E63]" />
    </button>
  );
}
