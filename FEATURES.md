# Studio OS Cloud — Feature Inventory

A complete, organized rundown of every feature shipped on the Studio OS Cloud website (Next.js 16 app + mobile sub-app + parents portal), plus every security control protecting it. This file is the canonical reference — when asked "what does my website do?" or "is X protected?", answer from here.

Last updated: 2026-04-23.

---

## 1. Photographer Dashboard (`/dashboard/*`)

The desktop-first command center for the studio.

### 1.1 Overview home (`/dashboard`)
- Time-of-day greeting + full date (Good morning · Wednesday, April 22).
- Profile badge in header — avatar (studio `logo_url` or gradient initials), business name, email; click-menu with Studio settings / Plan & billing / Sign out.
- Four stat cards (all clickable): Photo Coverage, Orders, Schools, Revenue. Each links to its underlying page.
- **Recent gallery activity** mini-table (ShootProof-inspired): 5 most recent galleries with GALLERY / PHOTOS / ORDERS / REVENUE columns, type chip (School vs Event), and a pending-orders pill. "View all →" drills into `/dashboard/gallery-activity`.
- **Studio Assistant** command bar with a grouped dropdown of 14 pre-written prompts across 4 optgroups (Today's overview / Orders & revenue / Schools & releases / Gallery optimization). Speak or type.
- **Spotlight global search** (⌘K / Ctrl+K anywhere in the dashboard) — fuzzy search across students, schools, events, orders. Color-coded hit types, keyboard-nav.

### 1.2 Orders (`/dashboard/orders`)
- Master list of every parent order across every gallery.
- 4-stat strip (Total / Revenue / Pending / Completed).
- Details side-panel with customer, line items, totals, notes.
- Status chips (pending / processing / shipped / completed / refunded).
- Mobile: full-width detail panel, auto-scroll into view on select.
- Horizontal-scroll table wrap so all 8 columns stay readable on iPhone.

### 1.3 Schools
- **List** (`/dashboard/schools`): grid of school cards with cover, status pill, counts. Search + filter. Mobile: 2-up grid at 160px minmax, floating "+ New" action bar.
- **Detail** (`/dashboard/projects/schools/[schoolId]`): aside with cover upload, contact, access/privacy summary, Settings / Visitors / Orders links. Right-hand album grid (classes + roles + people). Mobile: single-column stack.
- **Classes** — roster management per class.
- **Roles** (formerly "Custom Albums") — grouping buckets (siblings, staff, graduates, etc).
- **Settings** (`/dashboard/projects/schools/[schoolId]/settings`): school name, cover, contact, access mode (PIN / open / email-gate), PIN pool, watermark toggles, gallery window, **Screenshot Protection subsection (desktop / mobile / watermark toggles)**, pre-release mode, download controls, composites, delete-school flow.
- **Visitors** — session-by-session view log.
- **Orders** (`/dashboard/projects/schools/[schoolId]/orders`): scoped to this school. 4-stat strip, search across student/order#/email/package, expandable line-item breakdown, "Open full details" deep-link.

### 1.4 Events
- **List** (`/dashboard/projects/events`): card grid ordered by `event_date DESC`. Photo count + order count + status pill per card.
- **Detail** (`/dashboard/projects/[id]`): albums grid, visitor panel (Orders, Visitors, Favorites), access summary, share PIN, release flow.
- **Albums** (`/dashboard/projects/[id]/albums/[albumId]`): photo grid with bulk-select, move, delete, reorder, rename.
- **Settings** (`/dashboard/projects/[id]/settings`): title, client name, event date, cover, access (PIN/open/email), watermark, gallery window, **Screenshot Protection subsection**, pre-release mode, download controls, delete-event flow.
- **New event** (`/dashboard/projects/events/new`): wizard.
- **Visitors** — per-event session log.
- **Orders** (`/dashboard/projects/[id]/orders`): scoped to this event with same 4-stat strip + search + line items.

### 1.5 Packages (`/dashboard/packages`)
- Define print / digital / combo packages parents can purchase.
- Tier pricing, included quantities, add-ons, tax rules.

### 1.6 Backdrops (`/dashboard/backdrops`)
- Upload and manage virtual backdrops used in composites.
- Categorized by type (Textures, Scenes, etc).
- Backdrops sync bidirectionally with the desktop Flutter app (Supabase Storage `backdrops` bucket is the only live origin; old Cloudflare R2 host is dead).

### 1.7 Admin — Users (`/dashboard/admin/users`)
- Multi-tenant management view for owner-admins: photographers on the platform, trial status, plan, last activity, suspend/reactivate.
- Mobile: horizontal-scroll table so all 6 columns stay readable.

### 1.8 Gallery activity (`/dashboard/gallery-activity`)
- Full drill-down of the dashboard mini-table: every school + event ever, with search, type toggle (All / Schools / Events), sort (Recent / Orders / Revenue / Name). Mobile: stacked cards.

### 1.9 Membership (`/dashboard/membership`)
- Plan & billing page: current plan, Stripe-managed subscription, upgrade/downgrade, invoices.

### 1.10 Settings (`/dashboard/settings`)
- Studio profile: name, logo, contact, watermark defaults, email sender, notification preferences, default access mode.

### 1.11 Feature requests (`/dashboard/feature-requests`)
- Roadmap-style feedback board: request feature, upvote, see status.

### 1.12 Studio OS app rollout (`/dashboard/settings/studio-os-app-rollout`)
- Admin gate for rolling out the desktop Flutter app to photographers: license keys, download URLs, version.

### 1.13 Studio Assistant debug (`/dashboard/studio-assistant/debug`)
- Internal: inspect the assistant's intent parsing, tool plans, and actual execution logs for a given prompt.

---

## 2. Mobile sub-app (`/m/*`)

A standalone mobile experience optimized for iPhone — not a full PWA, but a dedicated `/m` surface with sticky header + bottom tab bar so a photographer can triage orders, grab PINs, and share galleries in seconds.

- **`/m` home** — greeting, 3-stat strip (New today / Unread / Schools), prominent Spotlight search, 4-tile quick-nav.
- **`/m/orders`** list + **`/m/orders/[id]`** detail — tap-to-call parent, tap-to-email, `seen_by_photographer` flips on view, unread-badge on the bell icon.
- **`/m/schools`** list + **`/m/schools/[id]`** detail — hero cover, status pill, per-student PIN reveal (eye toggle), copy-PIN, share link + PIN.
- **`/m/events`** list + **`/m/events/[id]`** detail — same hero pattern; single event-level PIN card with reveal/copy/share, photo count, recent orders strip.
- Sticky bottom tab bar: Home / Orders / Schools / Events.
- Unread badge counts orders with `seen_by_photographer = false`.
- Layout clamps to 480px on desktop so `/m` degrades sanely if opened on a larger browser.

---

## 3. Parents Portal (`/parents/*`, `/g/[slug]`)

Where the clients (parents) actually land.

### 3.1 Login (`/parents`)
- Two entry modes: School (class code + student PIN) OR Event (event PIN).
- Email-gating option: parent's email captured before gallery loads.
- Defensive JSON parse (fixes Safari's "string did not match expected pattern" DOMException).

### 3.2 Gallery (`/parents/[pin]`)
- Student-scoped or event-scoped photo gallery.
- Watermark stamp (studio logo at configurable opacity).
- Black-and-white preview toggle.
- Cover photo + hero banner.
- Favorites (heart icon) persisted per-session.
- Package purchasing via Stripe Checkout (integrated with `/dashboard/packages`).
- Free digital downloads (when studio enables them).
- Composites: parent picks a photo + a backdrop → rendered composite image.
- Background removal preview (via `nobg-photos` bucket).
- Download manifest (zip of selected originals when authorized).
- Pre-release registration: if gallery is pre-release, parents can register their email to be notified when live.

### 3.3 Short links (`/g/[slug]`)
- Human-readable share URL that resolves to the underlying gallery (`/parents/[pin]`).

### 3.4 Screenshot Protection (Phase 1, NEW)
Per-school AND per-event toggles, parents-portal only — the photographer dashboard is never affected.

Three independently-toggleable layers:

- **Desktop defenses**: keystroke listener blocks + blurs on ⌘⇧3 / ⌘⇧4 / ⌘⇧5 / ⌘⇧6 (macOS), PrintScreen (Windows), ⌘⇧P (Chrome DevTools capture). Window-blur handler blurs the page when focus is stolen (catches Snipping Tool / similar). Right-click context menu disabled. Drag-start disabled on `<img>` (blocks drag-into-new-tab).
- **Mobile defenses**: long-press (>420ms) on an image blurs the page for 2.8s so the iOS/Android "Save Image" system sheet captures a blurred frame. `-webkit-touch-callout: none` + `user-select: none` on all images. Context menu disabled.
- **Visible watermark**: tiled SVG overlay at 22% opacity across the whole viewport, rotated −24°, stamped with `"<parentEmail> · <date>"`. `pointer-events: none`. Every successful capture carries the viewer's email and date.

When a capture is detected, `filter: blur(22px) saturate(0.6)` is applied to `document.body` for 2-3 seconds. A "Gallery hidden — screenshots are not permitted." notice is portaled to `document.documentElement` so it stays crisp while the rest of the page is blurred.

**Known limits** (by design — this is Phase 1): screen-recording apps that don't steal focus (Loom / OBS / QuickTime started before load), headless browsers, users who disable JS, any OS-level capture that doesn't route through the browser. Phase 2 (server-side image tiling + per-tile signed URLs + rate-limited stitching) is deferred as multi-day backend work.

---

## 4. Sign-in + Auth (`/sign-in`)

- Supabase Auth with email + password.
- MFA / TOTP enforced via `getAuthenticatorAssuranceLevel()` — photographer must pass the TOTP challenge before reaching the dashboard.
- `/forgot-password` + `/reset-password` flows.
- Voice-access code path (`/api/auth/voice-access`) for admin-assisted sign-in.

---

## 5. Studio Assistant

An AI co-pilot inside `/dashboard`.

- **Parse** (`/api/studio-assistant/parse`): turns natural-language prompts into structured intents.
- **Plan** (`/api/studio-assistant/plan`): composes a tool-use plan for the intent.
- **Run** (`/api/studio-assistant/run`): executes the plan against the photographer's data.
- **TTS** (`/api/studio-assistant/tts`): speaks replies.
- **Logs** (`/api/studio-assistant/logs`): debug trace.
- Command bar on `/dashboard` home with 14 prewritten prompts in 4 groups (Today's overview / Orders & revenue / Schools & releases / Gallery optimization).

---

## 6. Studio OS Desktop App (Flutter, macOS)

Local-first companion that syncs to the cloud.

- Backdrop Manager with "Push to Cloud" flow — uploads to Supabase Storage `backdrops` bucket, inserts into `backdrop_catalog`.
- **Permanent error surfacing**: `BackdropSyncResult` captures per-entry failures with stage context (file-missing / upload / insert / update). UI shows "⚠️ Pushed X/Y. Failed: …" banner + auto-opens failure dialog with Copy-details button.
- License activation via `/api/studio-os-app/activate` + validation on each launch via `/api/studio-os-app/validate`.
- Public download (`/api/studio-os-app/public-download`) gated by admin rollout settings.
- Roster subfolders are UI-filtered out in Project mode (`isRosterCollection()` regex).

---

## 7. Integrations

- **Stripe Connect** — checkout (`/api/stripe/checkout`), webhook (`/api/stripe/webhook`), Connect onboarding (`/api/stripe/connect`), billing portal (`/api/stripe/billing`), status endpoint (`/api/stripe/status`).
- **Supabase** — Postgres + Storage + Auth + MFA + Realtime. Project id `bwqhzczxoevouiondjak`.
- **Cloudflare R2** — media storage (`whitephoto-media` bucket) for high-res originals.
- **Upstash Redis** — persistent rate limiting (`lib/rate-limit.ts`).
- **Transactional email** — order confirmations, pre-release notifications, magic links.
- **Next.js 16.1.6** (Turbopack) on **Vercel** — deployed from `origin/main`.

---

## 8. Cron jobs

Scheduled background tasks (hit via `/api/cron/*`):

- **abandoned-cart-reminders** — parents who added photos but didn't check out get a nudge email.
- **archive-expired-galleries** — gallery windows past their end date are auto-archived.
- **stripe-billing-sync** — pulls subscription status from Stripe so Membership reflects truth.

---

## 9. Security controls

### 9.1 Network + headers (`proxy.ts`)
Next.js 16 uses `proxy.ts` (not `middleware.ts`) as the request proxy. Every response carries:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (clickjacking protection)
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` (browser features denied)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (HSTS preload)
- CSP reporting endpoint (`/api/csp-report`) ready to receive violation reports.

### 9.2 Rate limiting (`lib/rate-limit.ts`)
- Upstash Redis-backed persistent limiter — survives deploys and cold starts.
- Two tiers: **strict** (sensitive endpoints) and **standard** (general API).
- Strict tier protects: Studio OS app activate, Studio OS app validate, portal school access, portal event access, forgot-password.
- Init is try/catch wrapped — if Upstash env vars are missing/malformed, falls back to an in-memory limiter instead of crashing the route (fixes the Safari DOMException 500 class of bug).

### 9.3 Input validation (Zod)
- Mutating dashboard routes (school PATCH, event PATCH, package PATCH, etc.) validate payloads with Zod schemas before hitting the DB.
- Unknown fields rejected. Types coerced server-side.

### 9.4 Audit logging (`lib/audit.ts`)
- Every sensitive mutation writes to `audit_log` via `recordAudit()`.
- `diffFields()` computes the minimal before/after delta so logs don't bloat.
- Covers school updates, event updates, access changes, **screenshot protection toggles**, package changes, order state transitions.

### 9.5 Tenant isolation — Supabase Storage RLS
Hardened across **Round 6g** + **Round 6g.2**:

- `backdrops/` bucket — writes require `(storage.foldername(name))[1] IN (select id::text from photographers where user_id = auth.uid())`. Photographers can only touch their own folder. Service-role bypasses RLS so maintenance scripts still work.
- `nobg-photos/` bucket — zero authenticated write policies. All writes require service-role key.
- `thumbs/` bucket — zero authenticated write policies. All writes require service-role key.
- `studio-logos/` bucket — already tenant-isolated.
- Public SELECT preserved on all read-public buckets so galleries still render.

### 9.6 Supabase Postgres
- Row-Level Security enabled on tenant-owned tables (`schools`, `projects`, `media`, `orders`, `packages`, `students`, `backdrop_catalog`, `audit_log`).
- Photographer ID is derived from `auth.uid()` inside RLS policies — no client-supplied photographer IDs are trusted.
- Service-role key only used server-side (never shipped to the browser).

### 9.7 Supabase Auth
- Email + password + **MFA/TOTP** required for photographer sign-in.
- MFA challenge + factor lifecycle managed via Supabase Admin API (stale factors cleaned up).

### 9.8 Screenshot protection Phase 1
See section 3.4. Every successful capture is stamped with the viewer's email and the date — leaks are traceable.

### 9.9 Defensive JSON parsing
- Login forms (`app/parents/LoginForm.tsx`) wrap `response.json()` in try/catch so HTML 500s surface as "Server error…" instead of cryptic DOMExceptions.

### 9.10 Ownership re-verification on uploads
Post-breach hardening sweep:

- `upload-to-r2` route checks `second === photographerId` in the path before accepting an upload.
- `generate-thumbnails` route mirrors the check.
- `storage-folder` route mirrors the check (this was the silent 403 source — desktop app called it before upload-to-r2 and bailed early).

### 9.11 Stripe refund revalidation
- Refund webhooks trigger re-checks of order state (`Round 10`) — no more trust-the-webhook-blindly pattern.

### 9.12 Audit log retention
- Old audit rows pruned on a scheduled job (keeps hot data fast without losing forensic trail).

### 9.13 Security headers audit-ready
- `/api/csp-report` endpoint receives any CSP violations the browser reports, so we can progressively tighten CSP without breaking parents in the wild.

---

## 10. Data model (high level)

- `photographers` — tenant anchor (owned by `auth.uid()`).
- `schools` — per-photographer school galleries.
- `projects` — per-photographer events (workflow_type='event'), drives the shared UI.
- `students` — roster per school.
- `media` — every uploaded photo (storage_path, thumbnail, preview, owner scope).
- `backdrop_catalog` — virtual backdrops used in composites.
- `packages` + `package_items` — what parents can buy.
- `orders` + `order_items` — parent purchases.
- `favorites` — heart button state.
- `visitor_sessions` — per-session portal visits.
- `audit_log` — every sensitive mutation.
- `collections` + `albums` — sub-grouping inside projects (Classes, Roles, etc).

All tables carry `photographer_id` + RLS for tenant isolation.

---

## 11. Known deferred work (visible on the roadmap)

- **Screenshot Protection Phase 2** — server-side image tiling proxy + per-tile signed URLs + rate-limited stitching. Defeats screen recording that Phase 1 cannot. Multi-day backend work.
- **Thumbs path normalization** — 2,152 storage objects + 1,152 DB rows. Deferred indefinitely; not worth the risk.
- **Thumbs orphan cleanup** — staged script (`scripts/cleanup-thumbs-orphans.mjs`) for 651 orphans. Harout must run from Mac with service-role key.
- **Order source badge** (Printed in-studio vs Cloud) — next round.
- **One-click "Email order summary to parent"** button on the per-school / per-event orders page — next round.
- **iPhone verification pass** on remaining dashboard sub-pages (`/dashboard/packages`, `/dashboard/settings`, `/dashboard/membership`, `/dashboard/feature-requests`, `/dashboard/backdrops`, project detail pages).

---

## Quick reference — "What does my site actually do?"

**Parents can**: log in with a PIN (or open/email-gate), view watermarked galleries (protected from casual screenshots), favorite photos, build composites with virtual backdrops, download free images if allowed, and buy packages via Stripe.

**Photographers can**: run a full studio from `/dashboard` — schools, events, albums, packages, backdrops, orders, visitor analytics, per-gallery release/access controls, screenshot protection toggles, a Spotlight search, an AI Studio Assistant, a profile/billing surface — and the same core flows condensed into `/m` for iPhone triage.

**Admins can**: manage photographer tenants, Studio OS desktop-app license rollouts, and feature-request triage.

**The platform enforces**: MFA on sign-in, Upstash-backed rate limits on sensitive endpoints, HSTS + frame/clickjacking protection, per-tenant Supabase RLS on every owned table, Supabase Storage policies that lock down cross-tenant writes, Zod input validation, audit logging of every sensitive change, defensive JSON parsing, ownership re-verification on uploads, and parents-portal screenshot protection with traceable watermarks.
