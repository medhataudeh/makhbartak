import type { Metadata, Viewport } from "next";
import { Readex_Pro } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

const readex = Readex_Pro({
  subsets: ["arabic", "latin"],
  weight: ["200", "300", "400", "500", "600", "700"],
  variable: "--font-readex",
  display: "swap",
});

// Phase 3.5 SEO — richer metadata with OpenGraph and a base canonical URL.
// Per-page metadata still overrides this default via individual route
// `generateMetadata` helpers (see content pages) when needed.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://makhbartak.app"),
  title: {
    default: "مختبرك – تحاليل طبية في بيتك",
    template: "%s — مختبرك",
  },
  description: "اطلب تحاليلك المخبرية من راحة بيتك في دمشق وريف دمشق. ممرض معتمد يأتي إليك ويأخذ العينة، وتصلك النتائج عبر هاتفك.",
  keywords: ["تحاليل منزلية", "مختبر", "دمشق", "ريف دمشق", "زيارة ممرض", "نتائج مخبرية"],
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "مختبرك" },
  openGraph: {
    type: "website",
    locale: "ar_SY",
    siteName: "مختبرك",
    title: "مختبرك – تحاليل طبية في بيتك",
    description: "اطلب تحاليلك المخبرية من راحة بيتك. ممرض معتمد يأتي إليك ويأخذ العينة.",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "MedicalOrganization",
  "name": "مختبرك",
  "url": process.env.NEXT_PUBLIC_SITE_URL ?? "https://makhbartak.app",
  "areaServed": [
    { "@type": "City", "name": "دمشق" },
    { "@type": "City", "name": "ريف دمشق" },
  ],
  "medicalSpecialty": "ClinicalLaboratoryScience",
};

export const viewport: Viewport = {
  themeColor: "#0891B2",
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover lets iOS Safari resolve env(safe-area-inset-*) to
  // the real notch/home-indicator insets. Without it, env() returns 0 and
  // every safe-area utility collapses to its base padding.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={readex.variable}>
      <body className="font-sans bg-gray-50 text-[#164E63] antialiased">
        {/* Schema.org Organization markup — indexable by Google + AI agents. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
        />
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
