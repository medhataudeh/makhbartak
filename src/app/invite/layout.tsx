import type { Metadata } from "next";

// The invite-accept surface must never be indexed — it carries account-setup
// state. Mirrors the staff-portal robots cascade.
export const metadata: Metadata = {
  title: "قبول الدعوة | مختبرتك",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
