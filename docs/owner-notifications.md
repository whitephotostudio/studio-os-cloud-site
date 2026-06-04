# Owner Notifications

Studio OS Cloud can send owner-only phone alerts through Pushover for important business events.

## Required Vercel Environment Variables

Set these as server-side Vercel environment variables. Do not prefix them with `NEXT_PUBLIC_`.

```txt
PUSHOVER_APP_TOKEN=your_pushover_application_api_token
PUSHOVER_USER_KEY=your_pushover_user_or_group_key
```

Optional:

```txt
PUSHOVER_DEVICE=optional_device_name
OWNER_NOTIFICATIONS_ENABLED=true
NEXT_PUBLIC_SITE_URL=https://www.studiooscloud.com
```

`OWNER_NOTIFICATIONS_ENABLED=false` disables sending without removing the keys.

## Events That Send Phone Alerts

- New verified photographer record created in Studio OS Cloud.
- New Studio OS plan subscription completed through Stripe Checkout.
- Subscription payment failure.
- Subscription cancellation.
- High-intent public website visits.
- All public website visits.
- Marketing CTA and sample-gallery clicks.

The owner controls these from:

```txt
/dashboard/admin/notifications
```

The default settings keep business-critical alerts on and noisy website visit alerts off.

## Activity Report

The notification center also records a short recent-history report for public marketing activity:

- Page views.
- Marketing CTA clicks.
- High-intent pages such as pricing, signup, download, sample galleries, and comparison pages.
- Approximate browser/device and Vercel country/region/city headers when available.

The tracker excludes dashboard, parent portal, client gallery, mobile app, API, and Next.js asset routes.
It does not store IP addresses.

## Test Endpoint

After signing in as a platform admin, open `/dashboard/admin/notifications` and click **Send Test Push**.
The endpoint only works for platform admins and only when Pushover env vars are configured.
