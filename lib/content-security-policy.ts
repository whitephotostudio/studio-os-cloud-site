/** Per-response script nonces protect hydrated pages without allowing arbitrary inline scripts. */
export function contentSecurityPolicy(nonce: string, development = false): string {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(nonce)) throw new Error("Invalid CSP nonce.");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    // Stripe.js/Checkout/Link origins follow Stripe's integration security guide.
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://*.r2.dev https://api.stripe.com https://checkout.stripe.com https://maps.googleapis.com https://link.com https://*.link.com${development ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://link.com https://*.link.com",
    "report-uri /api/csp-report",
    ...(!development ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
