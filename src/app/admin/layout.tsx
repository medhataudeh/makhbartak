import type { Metadata } from "next";

// Phase 5.1 — staff portal must never appear in search engines or AI
// indexes. The robots metadata cascade overrides the root layout's
// `robots: { index: true, follow: true }`.
export const metadata: Metadata = {
  title: "الإدارة | مختبرك",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
