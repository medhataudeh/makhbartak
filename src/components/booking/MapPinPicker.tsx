"use client";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MapPin, Crosshair } from "lucide-react";

// Lightweight stand-in for a real map. The user drags or taps a pin inside
// a fixed-aspect surface; the surface coordinates project linearly onto a
// small lat/lng box centered on Damascus. Replace with Google/Mapbox later
// — the contract `{ lat, lng } => onChange` is what the booking flow consumes
// so no caller changes are needed when the real map drops in.
const DAMASCUS_CENTER = { lat: 33.5138, lng: 36.2765 };
// Roughly ±0.04° around the center → ~9km box. Enough to hand-place
// inside the city without precision pretending to be sub-meter.
const HALF_LAT = 0.04;
const HALF_LNG = 0.05;

interface MapPinPickerProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  /** True once the user has placed/moved the pin — used to highlight the
   *  surface as "confirmed selection" instead of just showing the default
   *  centre point as if it were chosen. */
  placed?: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function coordsToPercent(lat: number, lng: number): { xPct: number; yPct: number } {
  const xPct = clamp(((lng - (DAMASCUS_CENTER.lng - HALF_LNG)) / (HALF_LNG * 2)) * 100, 0, 100);
  // Latitude inverts because higher lat = north = top of the surface.
  const yPct = clamp(((DAMASCUS_CENTER.lat + HALF_LAT - lat) / (HALF_LAT * 2)) * 100, 0, 100);
  return { xPct, yPct };
}

function percentToCoords(xPct: number, yPct: number): { lat: number; lng: number } {
  const lng = DAMASCUS_CENTER.lng - HALF_LNG + (xPct / 100) * HALF_LNG * 2;
  const lat = DAMASCUS_CENTER.lat + HALF_LAT - (yPct / 100) * HALF_LAT * 2;
  return { lat, lng };
}

export function MapPinPicker({ lat, lng, onChange, placed = false }: MapPinPickerProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const safeLat = Number.isFinite(lat) && lat !== 0 ? lat : DAMASCUS_CENTER.lat;
  const safeLng = Number.isFinite(lng) && lng !== 0 ? lng : DAMASCUS_CENTER.lng;
  const { xPct, yPct } = coordsToPercent(safeLat, safeLng);

  const updateFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const xRaw = ((e.clientX - rect.left) / rect.width) * 100;
    const yRaw = ((e.clientY - rect.top) / rect.height) * 100;
    const { lat: nextLat, lng: nextLng } = percentToCoords(clamp(xRaw, 0, 100), clamp(yRaw, 0, 100));
    onChange(nextLat, nextLng);
  };

  const handleRecenter = () => {
    onChange(DAMASCUS_CENTER.lat, DAMASCUS_CENTER.lng);
  };

  const handleUseMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Project to the box even if the device sits well outside it; we
        // clamp so the pin never escapes the visible surface.
        const { xPct: bx, yPct: by } = coordsToPercent(pos.coords.latitude, pos.coords.longitude);
        const { lat: nLat, lng: nLng } = percentToCoords(bx, by);
        onChange(nLat, nLng);
      },
      () => {
        // Silently ignore — the manual pin is still usable.
      },
      { enableHighAccuracy: true, timeout: 5000 },
    );
  };

  return (
    <div className="space-y-2">
      <div
        ref={surfaceRef}
        role="application"
        aria-label="اضغط لتحديد الموقع على الخريطة"
        // Fixed height + aspect hint guarantees the surface is visible even
        // inside narrow flex containers / bottom sheets where aspect alone
        // would collapse. The placeholder grid + roads remain visible until
        // a real provider drops in.
        style={{ minHeight: 260 }}
        className={`relative w-full h-[260px] md:h-[320px] rounded-xl overflow-hidden select-none touch-none cursor-crosshair transition-colors ${
          placed ? "bg-[#D1FAE5] border-2 border-[#059669]" : "bg-[#ECFEFF] border-2 border-dashed border-[#0891B2]/40"
        }`}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDragging(true);
          updateFromEvent(e);
        }}
        onPointerMove={(e) => { if (dragging) updateFromEvent(e); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {/* Decorative grid — placeholder for actual tiles. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(#bae6fd 1px, transparent 1px), linear-gradient(90deg, #bae6fd 1px, transparent 1px)",
            backgroundSize: "32px 32px, 32px 32px",
          }}
        />
        {/* Placeholder roads. */}
        <div aria-hidden="true" className="absolute inset-x-0 top-1/3 h-[3px] bg-white/70" />
        <div aria-hidden="true" className="absolute inset-y-0 start-1/2 w-[3px] bg-white/70" />

        {/* Persistent instruction banner along the top edge. After the pin
           is placed it flips to a confirmation chip in emerald. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-2 top-2 flex items-center justify-center pointer-events-none"
        >
          <div className={`px-3 py-1.5 rounded-full text-[11px] font-semibold shadow-sm ${
            placed ? "bg-[#059669] text-white" : "bg-white text-[#0E7490]"
          }`}>
            {placed ? "تم تحديد الموقع — يمكنك تعديله بالضغط مجدداً" : "اضغط لتحديد الموقع"}
          </div>
        </div>

        {/* Center crosshair — always visible so the user understands the
           surface is interactive even before placing the pin. */}
        {!placed && (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <Crosshair size={28} className="text-[#0891B2]/50" />
          </div>
        )}

        {/* The pin — anchored at its bottom-center so the tip is the actual
           point. Only rendered after the user explicitly placed it; before
           that the centre crosshair stands in. */}
        {placed && (
          <div
            className="absolute pointer-events-none"
            style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -100%)" }}
          >
            <MapPin
              size={42}
              className="text-[#059669] drop-shadow-lg"
              strokeWidth={2.5}
              fill="#10b981"
              aria-hidden="true"
            />
          </div>
        )}

        {/* Crosshair guide for active drag. */}
        {dragging && (
          <>
            <div className="absolute inset-y-0 w-px bg-[#0891B2]/60" style={{ left: `${xPct}%` }} aria-hidden="true" />
            <div className="absolute inset-x-0 h-px bg-[#0891B2]/60" style={{ top: `${yPct}%` }} aria-hidden="true" />
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className={`text-[11px] font-medium ${placed ? "text-[#059669]" : "text-amber-600"}`}>
          {placed ? "موقع محدد" : "لم يتم تحديد الموقع بعد"}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleUseMyLocation}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-[11px] text-[#0891B2] cursor-pointer active:bg-gray-50"
          >
            <Crosshair size={12} aria-hidden="true" />
            موقعي الحالي
          </button>
          <button
            type="button"
            onClick={handleRecenter}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-500 cursor-pointer active:bg-gray-50"
          >
            توسيط
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 lat" dir="ltr">
        {safeLat.toFixed(5)}, {safeLng.toFixed(5)}
      </p>
    </div>
  );
}
