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

  // Static security headers complement the per-response nonce CSP in proxy.ts.
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-DNS-Prefetch-Control", value: "on" },
        // Forces browsers to stay on HTTPS for a year; covers subdomains so
        // *.studio-os.cloud can't be downgraded either.
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
        // Blocks MIME-sniffing. A .js file being served as text/html (via an
        // open-redirect or misconfigured storage) cannot be re-interpreted
        // as a script by the browser.
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Prevents any site from iframing us, which defeats clickjacking
        // attacks against the dashboard and checkout flows. We don't embed
        // our own pages inside iframes, so DENY is safe.
        { key: "X-Frame-Options", value: "DENY" },
        // Sends the full referrer on same-origin navigations (needed for
        // analytics) but strips the path/query when going cross-origin, so
        // we don't leak order IDs or PINs to third parties.
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Deny access to powerful APIs the site never uses. Narrow scope
        // reduces supply-chain blast-radius if a dependency tries to
        // silently use them.
        {
          key: "Permissions-Policy",
          value:
            "camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
        },

      ],
    },
    {
      source: "/parents",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/sign-in",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/forgot-password",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/reset-password",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/dashboard/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    ...["/api/dashboard/in-house-test-orders", "/api/dashboard/in-house-test-files", "/api/labs-pilot/in-house", "/labs-pilot/in-house/:path*",
      "/api/dashboard/lab-production", "/api/dashboard/lab-production-assets", "/api/dashboard/lab-production-files", "/api/lab/production", "/lab/production",
      "/api/labs-pilot/production", "/labs-pilot/production/:path*"].map(source => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    })),
    {
      source: "/m/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/parents/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/schools/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/book",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/manage",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
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
