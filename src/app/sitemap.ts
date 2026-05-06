import type { MetadataRoute } from "next";

// Phase 5.1 — only public marketing routes appear in the sitemap. Staff
// portals and payment surfaces are explicitly excluded (they're also
// disallowed in robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://makhbartak.com";
  const now = new Date();
  return [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
  ];
}
