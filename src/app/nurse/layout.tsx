import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "الممرض | مختبرك",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function NurseLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
