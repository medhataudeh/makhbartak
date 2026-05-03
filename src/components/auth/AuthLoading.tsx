"use client";

// Splash shown while /api/me is in flight on the very first paint after a
// refresh. Every portal mounts this instead of the login form to avoid the
// "login flashes for ~200ms even though I'm logged in" UX. RTL Arabic
// copy; keeps the existing brand color scheme.
export function AuthLoading({ label = "جاري التحقق من الجلسة…" }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-app">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3"
      >
        <div className="w-9 h-9 rounded-full border-2 border-[#0891B2]/20 border-t-[#0891B2] animate-spin" aria-hidden="true" />
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}
