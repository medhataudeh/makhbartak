import type { MetadataRoute } from "next";

// Phase 5.1 — disallow crawling of staff portals, payment surfaces, and
// any backend endpoints. Customer marketing routes are still allowed.
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://makhbartak.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/nurse",
          "/nurse/",
          "/lab",
          "/lab/",
          "/payment",
          "/payment/",
          "/auth/",
          "/api/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
