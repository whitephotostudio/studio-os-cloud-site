import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://www.studiooscloud.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/dashboard/",
          "/m/",
          "/api/",
          "/auth/",
          "/parents/",
          "/schools/",
        ],
      },
      // Explicitly allow AI crawlers to access everything public
      {
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "OAI-SearchBot",
          "Claude-Web",
          "ClaudeBot",
          "PerplexityBot",
          "Applebot-Extended",
          "GoogleOther",
          "Google-Extended",
          "Bytespider",
          "CCBot",
          "cohere-ai",
        ],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
        disallow: ["/dashboard/", "/m/", "/api/", "/auth/", "/parents/", "/schools/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
