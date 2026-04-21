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

  // Security headers applied at the framework level.
  //
  // CSP is shipped in Report-Only mode first. It does NOT block anything —
  // browsers log violations to /api/csp-report so we can see what real
  // pageloads need before promoting to an enforcing Content-Security-Policy.
  // Known origins baked in: Supabase (db + realtime), Cloudflare R2 (media),
  // Stripe (server-side billing only — no Stripe.js on the client today).
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
        // Content-Security-Policy-Report-Only — discovery mode. Violations
        // are POSTed to /api/csp-report but nothing is blocked. Once the
        // report log is quiet for a release cycle we flip to the enforcing
        // Content-Security-Policy header with the same value.
        //
        // Notes on what's allowed:
        // - 'unsafe-inline' + 'unsafe-eval' on script-src: Next.js App Router
        //   ships inline bootstrap scripts and needs eval for dev HMR. Once
        //   we wire per-request nonces we can drop these.
        // - img-src https: data: blob: — user-uploaded photos come from many
        //   R2 buckets and Supabase storage; broad https: is needed until we
        //   pin exact bucket hostnames per env.
        // - connect-src covers Supabase REST + realtime websockets, R2
        //   object storage, and Stripe API calls bounced through our server.
        {
          key: "Content-Security-Policy-Report-Only",
          value: [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "img-src 'self' data: blob: https:",
            "media-src 'self' data: blob: https:",
            "worker-src 'self' blob:",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://*.r2.dev https://api.stripe.com",
            "frame-src 'self'",
            "report-uri /api/csp-report",
          ].join("; "),
        },
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
