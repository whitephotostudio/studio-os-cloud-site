import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://studiooscloud.com";

  // Static public pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/studio-os`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/studio-os/download`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/sign-up`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  // SEO landing pages
  const seoLandingPages: MetadataRoute.Sitemap = [
    "school-photography-software",
    "high-volume-photography-software",
    "photography-workflow-software",
    "online-photo-gallery-ordering-software",
    "pixieset-alternative",
    "gotphoto-alternative",
  ].map((slug) => ({
    url: `${baseUrl}/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.9,
  }));

  // Competitor comparison pages
  const competitors = [
    "gotphoto",
    "pixieset",
    "photoday",
    "shootproof",
    "smugmug",
    "zenfolio",
    "zno",
  ];

  const comparisonPages: MetadataRoute.Sitemap = competitors.map((name) => ({
    url: `${baseUrl}/compare/studio-os-vs-${name}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...seoLandingPages, ...comparisonPages];
}
