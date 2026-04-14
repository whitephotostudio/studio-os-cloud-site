import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "bwqhzczxoevouiondjak.supabase.co",
      },
    ],
    // Enable modern formats for better compression
    formats: ["image/avif", "image/webp"],
    // Cache optimized images for 30 days, allow stale for 1 year
    minimumCacheTTL: 2592000,
    // Allow reasonable device sizes for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // Compress responses
  compress: true,

  // Powered-by header leaks framework info — disable it
  poweredByHeader: false,

  // Security headers applied at the framework level
  // (CSP and most headers are in middleware.ts for more control)
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-DNS-Prefetch-Control", value: "on" },
      ],
    },
    {
      // Cache static assets aggressively
      source: "/(.*)\\.(js|css|woff2?|png|jpg|jpeg|gif|svg|ico|webp|avif)",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    },
  ],
};

export default nextConfig;
