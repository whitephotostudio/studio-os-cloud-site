# SEO Launch Checklist

Use this checklist before and after public marketing deployments.

## Before Deploy

- Run `npm run lint`.
- Run `npm run build`.
- Start the production build locally with `npm run start`.
- Run `npm run seo:crawl -- http://localhost:3000`.
- Check the homepage and `/sample-galleries` in a browser at desktop and mobile widths.
- Confirm public CTAs go to real pages, not placeholder routes.

## Crawl Rules

- Public marketing pages should return `200`.
- Public marketing pages should have a specific title, meta description, and canonical URL on `https://www.studiooscloud.com`.
- Sitemap URLs should not be blocked by `robots.txt`.
- `/parents`, `/sign-in`, `/forgot-password`, and `/reset-password` should stay out of the sitemap and carry `noindex`.
- Private dashboard, API, mobile dashboard, auth callback, parent gallery, and school gallery paths should stay blocked or private.

## After Deploy

- Verify `https://www.studiooscloud.com/robots.txt`.
- Verify `https://www.studiooscloud.com/sitemap.xml`.
- Submit or resubmit `https://www.studiooscloud.com/sitemap.xml` in Google Search Console.
- In Search Console, validate fixed indexing issues only after the production deployment is live.
- Spot check Search Console URL Inspection for:
  - `https://www.studiooscloud.com/`
  - `https://www.studiooscloud.com/sample-galleries`
  - `https://www.studiooscloud.com/pricing`

## Conversion Checks

- Click `Start Free Trial`, `Download App`, `Parents Portal`, `View Pricing`, and sample gallery cards.
- Confirm the browser sends `POST /api/marketing/conversions`.
- Confirm Vercel logs include `marketing_conversion` entries.
- Do not add third-party tracking cookies without updating the privacy policy.
