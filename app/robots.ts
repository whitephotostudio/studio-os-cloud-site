import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://studiooscloud.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/dashboard/",
          "/api/",
          "/auth/",
          "/parents/",
          "/schools/",
          "/sign-in",
          "/forgot-password",
          "/reset-password",
        ],
      },
      // Explicitly allow AI crawlers to access everything public
      {
        userAgent: ["GPTBot", "ChatGPT-User", "Claude-Web", "PerplexityBot", "Applebot-Extended"],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
        disallow: ["/dashboard/", "/api/", "/auth/", "/parents/", "/schools/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
