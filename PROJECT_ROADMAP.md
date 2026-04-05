# Studio OS Cloud Roadmap

Last updated: 2026-03-29

## Goal

Build one polished Studio OS Cloud platform that supports:

- School galleries
- Event / project / album galleries
- Ordering, packages, downloads, and favorites
- Photographer dashboard workflows
- Desktop Flutter app sync

The product direction is:

- clean Studio OS branding: red / black / white / grey
- mobile-friendly client experience
- smooth gallery navigation
- strong photographer controls without clutter
- additive improvements that do not break working flows

## What Is Already Working

### Event galleries

- Event login with email + PIN
- Pre-release registration flow
- Event albums and album browsing
- Persistent client favorites
- Photographer favorite reporting
- Event pricing / price sheet assignment at the project level
- Event ordering and Stripe checkout
- Client favorite downloads with photographer controls
- Download rules, watermark support, and print release support
- Event branding controls
- Event share emails, release emails, and abandoned cart reminders through Resend

### School galleries

- School login with email + PIN
- School settings stored in the database instead of browser-only state
- School email capture for parent access
- School email campaign and release-email foundation
- School auto-cover pipeline wired into upload flow

### Dashboard

- Schools page
- Events page
- Orders page
- Packages / price sheets page
- Event detail page with album management, favorite activity, visitor reporting
- Matching Studio OS Cloud visual direction across the main dashboard surfaces

### Platform / delivery

- Production deploys on Vercel
- Database migrations via Supabase
- Resend integrated for server email sending

## Important Code Hotspots

These are the places most likely to need refactoring as the product grows:

- `/Users/harouthagopian/Projects/studio-os-cloud-site/app/parents/[pin]/page.tsx`
  - Very large client gallery page. This is the main source of future mobile/smoothness work.
- `/Users/harouthagopian/Projects/studio-os-cloud-site/app/dashboard/projects/[id]/page.tsx`
  - Large event dashboard page with favorites, sharing, album management, and modals.
- `/Users/harouthagopian/Projects/studio-os-cloud-site/app/dashboard/projects/[id]/settings/page.tsx`
  - Large settings surface for event gallery controls.

## What Still Needs Work

### Highest priority

1. Parent gallery mobile optimization
- Make the client gallery feel fast and smooth on phones and tablets
- Reduce visual crowding in the viewer and store drawer
- Improve touch navigation and loading behavior

2. Gallery performance and smoothness
- Split the huge gallery page into smaller components
- Reduce unnecessary rerenders
- Improve thumbnail loading strategy and image preloading
- Make filmstrip / viewer / album switching feel more fluid

3. Store / ordering completion
- Finish any remaining partially wired store controls
- Validate school and event store parity
- Keep checkout logic clear and predictable

### Medium priority

4. Flutter app integration improvements
- Sync favorite `media_id`s into the app
- Build a virtual Favorites collection locally
- Optional export of a real Favorites folder when needed

5. Email workflow expansion
- Better dashboard email composer / campaign tools
- Delivery logs and visibility for sends
- Safer scheduling / automation around campaigns and reminders

6. Settings cleanup
- Continue simplifying settings screens
- Use more visual selectors and fewer raw form controls
- Keep event and school settings consistent

### Lower priority

7. Advanced automation
- Auto archive after expiration
- Better scheduled reminders
- More complete localization / translated client UI

8. Album-level pricing
- Right now price sheets apply at the event/project level
- Add per-album price sheet assignment if needed later

## Features That Need Honest QA / Follow-Up

These should be tested again end to end before calling them fully complete:

- School email campaign flow
- School auto-cover behavior on real uploads
- All free-download rule combinations
- Watermark and PDF print release downloads
- Abandoned cart reminder timing and dedupe behavior
- Event and school settings parity across all toggles

## Recommended Next Sprint

### Sprint focus: Mobile-friendly client gallery

Ship this next:

- Break `/app/parents/[pin]/page.tsx` into smaller components
- Create a real mobile-first gallery layout
- Tighten the viewer / filmstrip / action bar behavior
- Improve image loading and perceived speed
- Make store drawer and favorites flow cleaner on smaller screens

### Definition of done

- Gallery feels good on phone, tablet, and desktop
- No awkward overflow or giant dead space
- Touch interactions are easy
- Navigation feels smooth
- Viewer, favorites, and buying flow stay in sync

## Current Product Rules

- Do not remove working school or event functionality just to redesign
- Prefer additive changes over destructive rewrites
- Keep the orders page because it is a real working page
- Keep the dashboard visually consistent with Studio OS Cloud branding
- Use Resend for server-sent email workflows

## Nice To Have

- ZIP export for favorites instead of many separate downloads
- Better album cover curation tools
- More polished dashboard analytics
- Stronger preset system for branding and layouts
- Album-level pricing and album-specific client offers

## Short Version

The foundation is strong enough now.

The biggest next step is not another large feature block.
The biggest next step is making the client gallery mobile-friendly, fast, and smooth.
