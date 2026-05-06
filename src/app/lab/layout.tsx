import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "المختبر | مختبرك",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
