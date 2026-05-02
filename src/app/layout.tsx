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

export const metadata: Metadata = {
  title: "مختبرك – تحاليل طبية في بيتك",
  description: "اطلب تحاليلك المخبرية من راحة بيتك",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "مختبرك" },
};

export const viewport: Viewport = {
  themeColor: "#0891B2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={readex.variable}>
      <body className="font-sans bg-gray-50 text-[#164E63] antialiased">
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
