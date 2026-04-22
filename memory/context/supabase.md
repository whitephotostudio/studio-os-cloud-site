# Supabase context

**Project ref:** `bwqhzczxoevouiondjak`
**Storage public host:** `https://bwqhzczxoevouiondjak.supabase.co/storage/v1/object/public/`
**Tools:** Supabase MCP connector (use `mcp__6e6c7cf2-2b00-432f-be48-4dabaf745371__*`).

## Key tables (public schema)

| Table | Notes |
|-------|-------|
| `photographers` | One row per studio. Harout's `id` = `ed6b8a99-1f38-48f3-a198-447c49b5ac34`. Joined to `auth.users` via `user_id`. |
| `backdrop_catalog` | **Real** backdrop table. NOT `public.backdrops` (that doesn't exist). `image_url` + `thumbnail_url` must point at `bwqhzczxoevouiondjak.supabase.co/...backdrops/...`. Any `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` URL is a regression. |
| `collections` | Galleries under a project. Roster-style collections (title/slug matches `^\s*rosters?\s*$`) are filtered out in UI but NOT deleted from DB (per user's explicit request). |
| `orders`, `order_items` | Parent-facing purchases. Server-inserted only post-Round 6b / 6c. |
| `backdrop_selections` | Parent's backdrop choice per ordered item. RLS cleaned up in Round 6e. |

## Useful ad-hoc queries

```sql
-- Count backdrops for Harout:
SELECT count(*) FROM backdrop_catalog
WHERE photographer_id = 'ed6b8a99-1f38-48f3-a198-447c49b5ac34';

-- Find any stale R2-host rows (should be zero):
SELECT count(*) FROM backdrop_catalog
WHERE image_url     LIKE '%pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev%'
   OR thumbnail_url LIKE '%pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev%';

-- Find duplicate backdrop names per photographer (Textures cleanup candidates):
SELECT name, count(*) FROM backdrop_catalog
WHERE photographer_id = 'ed6b8a99-1f38-48f3-a198-447c49b5ac34'
GROUP BY name HAVING count(*) > 1
ORDER BY count(*) DESC;
```

## MFA troubleshooting

If Harout gets stuck behind a TOTP 2FA screen and doesn't have the authenticator:

```sql
-- Inspect:
SELECT * FROM auth.mfa_factors WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'harout@me.com'
);

-- Clear (challenges first because of FK):
DELETE FROM auth.mfa_challenges WHERE factor_id = '<factor-id>';
DELETE FROM auth.mfa_factors WHERE id = '<factor-id>';
```

This has been done before (2026-04-21, factor `5750ddee-c88a-4f90-bad6-e1540b5c830a`).

## `get_logs` service names

Valid: `api` | `branch-action` | `postgres` | `edge-function` | `auth` | `storage` | `realtime`.
NOT valid: `postgrest` (use `api` for HTTP-layer logs).

## Storage policies (post Rounds 6g + 6g.2)

- `backdrops` — public SELECT; authenticated INSERT/UPDATE/DELETE gated on `(storage.foldername(name))[1] IN (select id::text from photographers where user_id = auth.uid())`.
- `nobg-photos` — public SELECT; NO authenticated writes (service-role only).
- `thumbs` — public SELECT; NO authenticated writes (service-role only).
- `studio-logos` — untouched, already photographer-scoped.

Rollback SQL for Round 6g + 6g.2 lives at `docs/rollback/round-6g-rollback.sql`.

## Migration conventions

- Path: `supabase/migrations/YYYYMMDDHHMMSS_descriptive_name.sql`.
- Keep the timestamps realistic (use project's deployed TZ, but what matters is ordering).
- Always pair risky migrations with a rollback SQL in `docs/rollback/`.
