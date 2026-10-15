# Stripe Standard release and payment history

This implementation starts from the published `0b9ec06` tree, ports the account-history work from `00c8fac`, and preserves the later subscription, student-search and V3 fee changes. Implementation and test preparation do not establish that a production switch occurred. Record deployment, routing and provider proof separately.

## Commercial terms

Account routing never determines the photographer's agreed fee.

- New V3 Gallery subscriptions: 55 minor units per paid persisted order.
- New V3 Core and Studio subscriptions: 45 minor units per paid persisted order.
- Fees apply across gallery, portrait, event, school, sports, print and digital orders. Grouped purchases can contain several persisted orders and fees.
- The fee uses the supported sales currency without FX conversion. CAD subscription prices remain unchanged.
- Actual V2, legacy and trial terms, owner/admin/test/zero-value exemptions, existing waivers and frozen snapshots remain unchanged. A key-quantity change alone preserves the saved subscription price/profile.
- V2/V3 subscriptions have no second monthly order meter. Historical ledgers and refund credits retain their original rates.

The live pilot permits proven CAD and USD Standard routes. Unproven future currencies remain on ready original Express. No B2 migration, unlimited storage, storage promises, repricing or desktop changes belong to this release.

## Environments and ownership

Default is disabled. Test onboarding requires `STRIPE_STANDARD_MIGRATION_ENABLED=true`, a Stripe test key and loopback Supabase. Claimable `rkcs_test_` keys also require a pinned sandbox and fresh exact account/balance GET proof. Shared Vercel Preview credentials are not sandbox proof.

The live pilot is restricted to these exact identities:

| Resource | Identity |
| --- | --- |
| Platform | `acct_1TBlT4PxlnWeytFA` |
| Supabase | `bwqhzczxoevouiondjak` |
| Photographer | `ed6b8a99-1f38-48f3-a198-447c49b5ac34` |
| Owner | `4a9f37fe-d217-4edd-bcf9-3a561da2e2f0` |
| Original Express | `acct_1TIHTrLqg5vdCgpU` |
| Existing Standard | `acct_1UQHR5LZhEC2SlmP` |

Require the exact production URL/platform setting, live migration/checkout flags, authenticated owner, satisfied MFA, trusted origin, fresh platform/balance/account GET proof, and service-only SQL controls. Other photographers neither see the pilot UI nor use its mutations.

The live start action adopts only the existing Standard candidate. It cannot create a live merchant. After explicit ownership confirmation, it binds only known photographer/user metadata, re-retrieves the account, and registers proof. Conflicting ownership stops the operation. It changes no identity, bank details or agreements.

Readiness requires the correct controller, active cards/transfers, submitted details, enabled charges/payouts, and complete empty current/future requirement arrays. Missing state is not readiness. A bank object's `new` status is not individual bank verification.

## Additive schema and staged release

After the required backup and rehearsal, apply only these reviewed migrations in order:

1. `20261013010000_stripe_account_history.sql`
2. `20261013011000_stripe_payment_account_attempts.sql`
3. `20261013012000_stripe_merchant_event_recovery.sql`
4. `20261013021000_stripe_standard_creation_intents.sql`

Do not push the divergent historical migration directory. The creation-intent SQL still prohibits live merchant creation.

The service-only `whitephoto-20261015` control row defaults to disabled: `migration_enabled`, `checkout_enabled`, `reservation_required`, `activation_enabled`. Schema installation leaves Express selected. Read-only schema proof must report version `20261015010000` and the history/reservation protections.

1. Finish genuine sandbox onboarding, payments/fees/refunds, signed webhook delivery, real local Auth/PostgREST and rollback. Unit fixtures cannot replace these gates.
2. Recheck current production/main, platform, owner, merchant pair and newly linked photographers. Take and verify a consistent protected snapshot of affected financial state/schema. Never copy customers into the rehearsal.
3. Install additive schema with controls disabled. Verify original parent ordering and historical reads. Commit focused source; deploy only through `npm run deploy:production` from a clean checkout.
4. Enable the WhitePhoto reservation barrier before preparation/backfill. Old code cannot enter `checkout_starting` without a reservation. Already-started unknown requests require reconciliation; low traffic does not prove requests drained.
5. Enable narrow preparation flags/controls with `activation_enabled=false`. Audit permits empty Standard ownership only while exact original Express remains selected and the photographer is explicitly unmigrated. Partial, foreign or conflicting metadata always fails. All other provider readiness and original Express ownership checks remain mandatory.
6. Bind the existing candidate through the authenticated action. Run bounded history batches using original Express GETs. Preserve complete groups, gross/currency, frozen fees, references and uncertain requests. Never delete, reassign or blindly replay an unresolved attempt.
7. After every gate passes, enable activation and repeat the strict audit. Confirm the account pair and activate future unreserved eligible checkouts. SQL locks routing and rechecks immutable complete payment groups. Unresolved reservations beyond the safe retry window block activation.
8. Verify published routing, parent flow, original-account processing and configured application fees. Do not make live purchases or refund sales as tests. Keep Express connected.

Live flags automatically require full schema/control auditing. The audit uses GETs and distinguishes preparation from activation. Preserve the existing V3 catalog/unpaid Checkout guard.

## Reservations and original accounts

Reserve account, owner, complete order IDs, gross/currency, frozen fees, canonical request hash and idempotency before Stripe POST. Save provider references before publishing the Checkout URL. Lost replies retry the same account/request within 23 hours. Older unknown attempts require original-provider reconciliation.

Known open Express sessions remain readable with onboarding off. A known expired legacy session may be bound on demand only after original-account GET proof of identity, complete scope, amounts, currency and fees. Potentially paid intents and unknown `checkout_starting` markers cannot be blindly replaced. Provider-bound open sessions missing order references can be repaired; a rare expired crash-repair case conservatively requires reconciliation.

History resolution is independent of onboarding flags. Outages, permission errors and mismatches cannot select the current account as fallback. Compatibility requires a recognized absent schema and an explicitly unmigrated photographer.

## Webhooks, refunds and rollback

Customer charges/refunds use their immutable original connected account; application-fee resources are platform-scoped. Partial/full refunds preserve original fee, group, amount and currency. Historical Express events never replace selected Standard routing.

The merchant inbox acknowledges only successful effects and leases interrupted work. Unregistered Express account updates still refresh legacy readiness after schema installation. Unrelated Standard dashboard payments are ignored before order lookup, including generic third-party `order_id` metadata. Existing internal recovery events retain their payload hashes and still require the provider's `customer_order` marker.

Unpaid carts remain cancellable/dismissible before Stripe connection. Paid, uncertain and provider-referenced orders retain safety checks. The deployed merchant recovery cron requires `CRON_SECRET`; verify connected, dispute, deauthorization and application-fee events before activation.

Rollback re-verifies Express and changes only future routing. Standard history stays Standard; Express history stays Express. Closing activation after cutover does not erase history or prevent rollback. Disabling onboarding alone is not rollback. Never disconnect Express, cancel sessions to clear a gate, move balances or drop history.

## Evidence

Record unit/SQL, actual Auth/PostgREST, real provider fees/refunds, hosted Checkout completion, real signed webhook delivery, provider readiness, history reconciliation, optimized build, guarded deployment and routing as separate claims. Owner-exempt orders cannot prove collection.

The isolated harness pins a test platform, requires `balance.livemode=false` before writes, persists private durable idempotency/proof, and supports actual local Supabase. Direct PaymentIntent probes establish provider fee/refund behavior; they do not prove hosted Checkout completion or paid subscription activation. Browser and webhook acceptance remain separate gates.

## Protected provider and webhook preflight

`STUDIO_STANDARD_PROVIDER_RELEASE_VERIFY=1` runs an additional GET-only pre-schema audit in the protected remote build. Pin `STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID=acct_1TBlT4PxlnWeytFA`, `STUDIO_PAYMENT_EXPECTED_PROJECT_REF=bwqhzczxoevouiondjak`, the existing exact Supabase URL, and `STUDIO_PAYMENT_EXPECTED_APP_URL=https://www.studiooscloud.com`. The saved live Stripe key stays inside Vercel. Do not export it, replace it, enable migration flags for this check, or treat a Preview production credential as a test key.

This audit verifies platform/balance and the exact existing merchant pair. Empty Standard ownership can be reported before adoption; conflicting ownership fails. Its output explicitly does **not** prove database routing or activation readiness. Missing current/future readiness or event delivery configuration blocks the check.

Standard-enabled releases additionally require provider `GET /v2/core/event_destinations?include[0]=webhook_endpoint.url&limit=100`, using `Stripe-Version: 2026-09-30.endive`. Only live, enabled **snapshot** destinations at the exact Studio OS webhook URL qualify. `events_from` must explicitly include `@accounts` for customer payment/refund, account readiness/deauthorization, and all five supported dispute events; it must include `@self` for `application_fee.refunded` and `application_fee.refund.updated`. Missing or paginated evidence fails closed. V1 `application` is not accepted as proof of event scope. Existing disabled-schema releases retain their earlier webhook checks.

If the v2 API does not expose a legacy destination, retain the failure and inspect its **Events from**, payload format and subscribed events in signed-in Stripe Workbench. Do not infer scope from a label or silently bypass the guard. Resolve provider evidence before activation. This audit never changes subscriptions, endpoints, secrets or financial state. Official references: [Connect event scopes](https://docs.stripe.com/connect/webhooks), [event destination fields](https://docs.stripe.com/api/v2/core/event-destinations/object), and [destination list include fields](https://docs.stripe.com/api/v2/core/event-destinations/list).

Vercel Secret/Sensitive values are write-only through the dashboard/API. Cached Vercel authentication can verify exact project/deployment and variable metadata without exporting values; the remote build can use the protected values for provider GETs. Before the guarded production command, link this clean checkout to the freshly verified existing `studio-os-cloud-site` project, `prj_wlleVTNPMzBXyRMG4NFEFKga3ve8` under `team_i1VhiUxCf3SZPOKdmecBsu3r`. Do not let the CLI create or select a different project. Run only `npm run deploy:production` after the committed tree is clean and every release gate passes.
