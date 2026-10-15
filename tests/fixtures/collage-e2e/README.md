# Isolated collage purchase-to-print rehearsal

This fixture never reads `.env` files or production credentials. It binds only to loopback, creates a private temporary PGlite database and Redis socket, generates synthetic portraits, and refuses external network requests. It does not contact a printer.

Run the automated HTTP scenario:

```sh
node --test tests/collage-end-to-end.test.mjs
```

Run a reusable fixture for the browser and Flutter drivers:

```sh
COLLAGE_E2E_PORT=55468 node tests/fixtures/collage-e2e/server.mjs
```

The server prints its config path. Flutter's isolated driver can publish a standalone product and append collages to the seeded ordinary-print product. After that, exercise those products and create the paid production input:

```sh
node tests/fixtures/collage-e2e/scenario.mjs /absolute/fixture/config.json
```

For a Cloud-only rehearsal, add `--publish` to create the fixture's products through the same commerce API. Do not add it after the native driver has published. Start the real parent UI against that server in the clean worktree (no environment files):

```sh
node scripts/collage-e2e-browser.mjs --origin http://localhost:55468 --port 3114
```

Open `http://localhost:3114/collage-e2e` in a browser. The launcher mounts temporary page/proxy files, uses only fixture credentials, and removes those files on exit. It refuses to overwrite existing files or load local environment files. API requests use a same-origin proxy; signed photo URLs retain their canonical `/api/portal/` path so saved-cart media identity checks run unchanged. Fixture payments refuse external destinations. The latest fixture provider page returns to the local UI; an already running older fixture may require manually reopening the local page after the signed webhook completes. Automated HTTP scenarios cover the actual checkout-return confirmation separately.

Use a fresh browser origin after changing the fixture helper to avoid stale development chunks. Stop the launcher before TypeScript generation, full tests or a production build, so its temporary routes are absent. No helper page/proxy route is included in the shipped app.

Artifacts are written to the config's `outputDirectory`: independently cropped print PNGs, parent preview, restored basket, production ZIP, `http-e2e-receipt.json`, and `native-config.json`. The native production phase consumes `native-config.json` and produces its own Noritsu receipt and JPEG files. Fixture JWTs and all media are synthetic.

## What runs unchanged

The route handlers and their authorization/validation helpers run from source: dashboard bearer identity checks and agreement checks; parent bootstrap, HttpOnly cookie and lane scope revalidation; template ownership and access; publication/pricing RPC; single and combined order creation and idempotency; original-photo authorization; Stripe checkout; webhook signature verification, payment evidence validation and paid transition; individual production rendering, financial checks, order archive and parent history. The database applies the actual relevant SQL migrations. The REST adapter returns PostgreSQL JSON timestamps to preserve the commerce RPC's full-state comparison.

## Simulated boundaries and limits

- The GoTrue provider validates locally signed fixture JWTs. This proves the real dashboard auth consumer and tenant checks against an isolated identity service; it is not production Supabase auth verification.
- Stripe's HTTP transport is simulated. The provider receipt is explicitly labelled **not Stripe test mode**. Completion signs a synthetic provider webhook; the real webhook/payment handlers then update the real fixture SQL state. There is no manual database `paid` update and no charge.
- R2 and Supabase REST transports are local, with a small SQL-backed adapter for the exercised routes. Retained R2 namespace ownership SQL and server scope checks run unchanged. Private object GET signing is a fixture HMAC transport, not AWS SigV4 verification. Only synthetic media is available.
- The parent gallery's large context read model is a fixture adapter derived from SQL after real cookie/lane authorization. Checkout, preview, history, production and payment use real route handlers. This is not a full Next/Supabase deployment rehearsal.
- Email delivery and deferred email callbacks are not executed. The paid email outbox uses the real trigger; no email is sent. Optional monthly usage-provider maintenance is disabled in the fixture environment.
- No production migrations, deployments, customer data, payment-provider settings or physical prints are involved. A successful rehearsal does not enable the production checkout flag or establish live-provider readiness.
