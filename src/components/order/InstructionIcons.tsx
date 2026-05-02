import { Clock, Droplets, Pill, IdCard, Shirt, ClipboardList } from "lucide-react";

export const ICON_MAP: Record<string, React.ReactNode> = {
  clock: <Clock size={18} className="text-amber-600" />,
  droplets: <Droplets size={18} className="text-blue-500" />,
  pill: <Pill size={18} className="text-red-500" />,
  "id-card": <IdCard size={18} className="text-[#0891B2]" />,
  shirt: <Shirt size={18} className="text-gray-500" />,
  default: <ClipboardList size={18} className="text-gray-400" />,
};
