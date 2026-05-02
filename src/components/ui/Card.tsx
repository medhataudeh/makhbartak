import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export function Card({ children, className, onClick, hoverable = false }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-2xl border border-gray-100",
        "shadow-[0_1px_3px_rgba(0,0,0,0.05),_0_4px_12px_rgba(8,145,178,0.06)]",
        hoverable && "cursor-pointer transition-all duration-200 active:scale-[0.98] active:shadow-sm",
        hoverable && "hover:shadow-[0_4px_20px_rgba(8,145,178,0.12)]",
        className
      )}
    >
      {children}
    </div>
  );
}
