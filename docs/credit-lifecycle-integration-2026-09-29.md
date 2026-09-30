# Isolated credit and owner-fee lifecycle validation

The combined integration test is `tests/credit-lifecycle-integration.test.mjs`.
It connects the production Checkout/payment helpers and cloud-removal handler
to a fresh in-memory PostgreSQL database using PGlite. All five candidate
credit, profile-protection, cloud-job, order-fee and paid-cutout migrations run there.
Authenticated desktop RPCs execute as `authenticated`; cloud accounting and
ledger queries execute as `service_role`, including its Supabase-style RLS
bypass. The fixture is closed after every case.

Every network boundary is replaced with a deterministic fixture that refuses
unknown requests. Stripe calls use a literal fake test key; Photoroom and R2
use fake transport/storage. Customer photos, production secrets, real balances,
Stripe objects and remote databases are never used. Image input/output
validation uses actual JPEG/PNG encoding and decoding through `sharp`.

The combined cases verify:

- Checkout and PaymentIntent carry the same immutable account, pack, credit,
  amount and CAD currency metadata. Unpaid, wrong-account, wrong-amount and
  wrong-currency fulfillments cannot grant credits.
- A grant committed before a lost refund-query response survives, and a retry
  cannot grant it again. A cash refund arriving before Checkout fulfillment
  eventually leaves only the unrefunded credits, including repeated retries.
- A three-photo Photoshop reservation spends once, refunds one failed photo
  once, finalizes the two successes, and rejects a later forged full refund.
- The actual cloud route spends four credits, stores a validated PNG, replays
  the same paid output without another provider attempt, and refunds a failed
  attempt once while retaining its original monthly expiry.
- The successful cloud job binds the actual original/output SHA-256 pair to
  one spent receipt. Replaying it cannot mint a second photo entitlement.
- Cumulative cash refunds reverse a proportional credit amount once. Pending
  and failed refunds are ignored. A full cash refund of already-spent credits
  creates debt; the next purchase repays it. A late processing failure restores
  the corresponding repayment credits without minting a second refund.
- Purchased lots initially expire at the photographer's next monthly billing
  date. A due monthly lot expires once; successful cloud output remains
  replayable at zero balance. A failed reservation settling after the expiry
  restores no spendable credits and does not create a new deadline. Due-state
  fixtures move only isolated lot deadlines into the past rather than waiting
  a real month or changing a production clock.
- A paid customer order generates one owner service-fee meter request. A
  partial order refund retains the fee; a reported full refund queues one
  negative pending invoice item for the original customer, cents/currency and
  event reference on the next subscription bill. The ledger records verified
  queueing, not amendment of an existing invoice or actual settlement. It does
  not alter the photographer's AI credit wallet.
- Authenticated clients cannot rewrite balances, invoke the server-only cloud
  completion RPC, read the owner fee ledger or read another account's balance.

Run with:

```bash
node --test tests/credit-lifecycle-integration.test.mjs
```

This is integration of the actual payment helpers, cloud handler and SQL
accounting, with simulated provider boundaries. It does not establish real
Stripe settlement, signed webhook delivery, a Photoroom provider round trip,
R2 durability, production deployment, native Adobe action execution, or the
signed-in desktop/web purchase and refresh experience. Separate cutout database,
storage and revision tests cover imported-cutout entitlement enforcement.

A read-only setup check found no Stripe test key or isolated database variables
in the task's process or local environment file. The local environment's Stripe
key is non-test and its Supabase target is production. Values were not printed,
and those credentials were not used. This does not prove that no other test
account/project exists; it means none is configured in the inspected local
environment. Real external acceptance testing needs an isolated configured
environment or a separately authorized owner sample flow.
