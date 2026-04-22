# Studio OS Cloud (Next.js site)

**Repo:** `/Users/harouthagopian/Projects/studio-os-cloud-site`
**Remote:** `origin/main` (primary branch)
**Deploy:** Vercel (auto-deploys on push to `main`, ~2 min)
**Domain:** `studio-os-cloud.com`

## Stack

- Next.js 16.1.6 with Turbopack
- React 19 + TypeScript (strict)
- Tailwind CSS 4
- Supabase (Auth + Postgres + Storage) — project id `bwqhzczxoevouiondjak`
- Cloudflare R2 for gallery media (`whitephoto-media` bucket)
- Upstash Redis for rate limiting (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)
- Stripe for payments
- Resend / OpenAI / ElevenLabs as helper integrations

## Top-level layout

```
app/
  dashboard/            → photographer UI (auth required)
    layout.tsx          → mobile topbar/drawer + desktop sidebar
    page.tsx            → dashboard home (stat cards)
    orders/page.tsx     → orders table + detail panel
    projects/[id]/      → project detail, collections grid
    schools/…           → school mode
    backdrops/page.tsx  → backdrop catalog view
    settings/, packages/, membership/, feature-requests/, …
  parents/
    [pin]/page.tsx      → public parents portal (PIN-gated, ~10k+ lines)
    LoginForm.tsx       → school + event PIN login
  api/
    dashboard/          → photographer-facing API routes
      upload-to-r2/
      generate-thumbnails/
      storage-folder/
      …
    parents/            → parent-facing API routes (orders, etc.)
components/
  dashboard-sidebar.tsx → shared with mobile drawer overlay
  logo.tsx
  …
lib/
  supabase/client.ts, server.ts
  rate-limit.ts         → Upstash + in-memory fallback
  use-is-mobile.ts      → 640px matchMedia hook
  …
proxy.ts                → Next 16 middleware (rate limit + security headers)
supabase/
  migrations/           → timestamped SQL migrations
docs/
  rollback/             → rollback SQL for risky migrations
.studio_os_flutter/     → STALE snapshot of desktop app (gitignored, do NOT edit)
scripts/                → one-off maintenance (R2 backfill, etc.)
```

## Build / dev commands

```bash
# From repo root:
npm install
npm run dev         # local Next dev server (Turbopack)
npx tsc --noEmit    # typecheck only (sandbox uses this to verify)
npm run build       # production build
```

## Deploy flow

1. Commit to `main` locally.
2. `git push origin main` from Harout's Mac (sandbox cannot push).
3. Vercel auto-builds + deploys. Failures surface on Vercel dashboard.

## Critical architectural rules

- **`proxy.ts` IS the live middleware on Next 16.** Never recreate `middleware.ts` — the build errors hard with both present.
- **`backdrop_catalog` is the real backdrop table** — `public.backdrops` does not exist. Past ownership checks broke on this mistake.
- **Desktop app writes directly to Supabase Storage + PostgREST** for backdrops. It does NOT call `/api/dashboard/*` for the backdrop push path. Fixing a backdrop-push bug? Check the Dart source first.
- **Parents portal `/parents/[pin]/page.tsx` is massive (~11k lines).** Use `Grep` with line numbers before editing.
- **Mobile responsiveness** uses the `useIsMobile()` hook + inline-style conditionals, not Tailwind responsive classes for the dashboard pages. (Tailwind classes are used in some components but the dashboard pages predate the mobile pass.)

## Storage buckets (post Round 6g.2)

| Bucket | Public read? | Authenticated write? | Notes |
|--------|-------------|----------------------|-------|
| `backdrops` (Supabase) | Yes | Only if `foldername[1] = auth.uid's photographer_id` | Real live origin for backdrop images |
| `nobg-photos` (Supabase) | Yes | No (service-role only) | R2 does the actual writes from the desktop app |
| `thumbs` (Supabase) | Yes | No (service-role only) | Same — R2 writes from desktop |
| `whitephoto-media` (R2) | No (signed URLs) | S3 API with keys | Full-res gallery photos |
| `studio-logos` (Supabase) | Yes | Photographer-scoped | Untouched by Round 6g |

## Known gotchas

See `memory/glossary.md` → "Error signatures / symptoms" for the running list.
