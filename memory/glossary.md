# Glossary

Shorthand, product terms, and internal language for Studio OS Cloud Site.

## Product concepts

| Term | Meaning |
|------|---------|
| **Studio OS** | Umbrella product — photography studio management (desktop + web). |
| **Studio OS Cloud** | The Next.js web app at `studio-os-cloud.com`. Photographer dashboard + parents portal. |
| **Backdrop Manager** | The desktop Flutter app Harout uses in-studio to manage backdrops. Lives at `~/Downloads/Whitephoto_Studio_App_MVP_Source/`. |
| **Parents portal** | `/parents/[pin]` — unauthenticated parent view for ordering proofs. Gate is a short PIN. |
| **Photographer dashboard** | `/dashboard/*` — authenticated (Supabase Auth + optional MFA) area for Harout/staff. |
| **Proof** | A watermarked preview of a photo shown to parents before purchase. |
| **Backdrop swap** | AI feature that removes the background from a subject photo (`nobg-photos` bucket) and composites it over a selected backdrop. |
| **No-bg / nobg** | The cut-out, transparent-background version of a portrait. Bucket: `nobg-photos` (on R2). |
| **Roster** | Student/attendee list for a school or event. Project mode doesn't have rosters — they were silently appearing as phantom "rosters" subfolders and got filtered out in task #58. |
| **Noritsu** | The in-studio print lab hardware. Orders exported to Noritsu-format via the desktop app. |
| **SLIP** | The paper order slip that accompanies each Noritsu print job. |
| **Event mode** | Dance recital / wedding / sports-style shoot — one parent pool, many subjects. |
| **Project mode** | School picture-day-style shoot — many collections, each tied to a class/grade. |
| **School mode** | Same as project mode but with roster upload. |

## Storage / hosting

| Term | Meaning |
|------|---------|
| **R2** | Cloudflare R2. Bucket `whitephoto-media` stores full-res gallery photos. Accessed via signed URLs only. |
| **Old R2 public host** | `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` — **DEAD as of 2026-04-22**. Backdrops were migrated to Supabase Storage. Any new row referencing this host is a regression. |
| **Backdrops bucket** | Supabase Storage `backdrops/` (public). Live origin for all backdrop image + thumbnail URLs. Write path is the desktop Flutter app → Supabase Storage direct. |
| **nobg-photos bucket** | R2 bucket (confusingly named — there's also a Supabase bucket by similar name that is now locked down). Cut-outs live here. |
| **thumbs bucket** | R2 bucket for photo thumbnails. Legacy path shapes (`projects/`, `schools/`, UUID) still exist. |

## Infra / tooling

| Term | Meaning |
|------|---------|
| **Upstash** | Redis provider used by `lib/rate-limit.ts`. Env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Falls back to in-memory if init fails. |
| **proxy.ts** | Next.js 16 renamed `middleware.ts` → `proxy.ts`. Function export is `proxy(request)`. LIVE file — rate limiting + security headers run from here. Never recreate `middleware.ts` alongside it. |
| **Supabase MCP** | Model Context Protocol connector for the Supabase project. Used for SQL migrations and log inspection. |
| **PostgREST** | Supabase's auto-generated REST API. NOT a valid `get_logs` service (use `api` for HTTP-layer or `postgres` for DB). |

## Hardening rounds

Harout has been working through a numbered sequence of hardening rounds post-breach. Rough map:

| Round | What |
|-------|------|
| Round 2 | Money & abuse paths audit |
| Round 3 | Headers, anon-writes, admin, Noritsu, refund, errors |
| Round 4 | Sanitize MED-bucket error responses |
| Round 6 | Migrate parents-portal anon inserts to API routes |
| Round 6b | Parents-portal orders insert server-side |
| Round 6c | Event-mode orders insert server-side |
| Round 6d | Server-side ordering-window gate |
| Round 6e | `backdrop_selections` RLS cleanup |
| Round 6f | Storage bucket policy audit |
| Round 6g | Cross-studio storage policy tightening — backdrops + thumbs dedup |
| Round 6g.2 | nobg-photos + thumbs writes now require service-role |
| Round 7a | Zod foundation + high-risk dashboard routes |
| Round 7b | Zod coverage fan-out to remaining dashboard routes |
| Round 8 | Persistent rate limiter via Upstash Redis |
| Round 9 | Audit logging design + schema |
| Round 10 | Refund revalidation design + impl |

## Error signatures / symptoms

| Symptom | Likely cause |
|---------|--------------|
| Safari: "The string did not match the expected pattern" | DOMException from `response.json()` on an HTML 500. Wrap fetch responses defensively. |
| Backdrop push silently does nothing | Pre-2026-04-22: `storage-folder/route.ts` ownership check hitting non-existent `backdrops` table. Post-fix: desktop app's silent catch was swallowing the real error — now surfaced via `BackdropSyncResult.failures`. |
| Parents-portal backdrop grid shows gray tiles | Row's `image_url` / `thumbnail_url` points at dead `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` host. Rewrite to `bwqhzczxoevouiondjak.supabase.co/storage/v1/object/public/backdrops/…`. |
| Build fails "Both middleware file and proxy file detected" | Someone re-added `middleware.ts`. Delete it; only `proxy.ts` is valid on Next.js 16. |
| `.git/*.lock` Operation not permitted | Sandbox can't unlink locks. User clears manually on Mac: `rm -f .git/HEAD.lock .git/index.lock`. |
