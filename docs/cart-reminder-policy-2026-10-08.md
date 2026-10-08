# Unfinished checkout reminders

Changing packages or poses can leave several unpaid checkout records. Reminder
delivery now selects only the latest unfinished attempt for the same studio,
gallery, purchase email and school student. A verified newer purchase suppresses
older attempts; later new checkouts and other children retain their own scope.

The first reminder is due after 24 hours. One follow-up is due after 72 hours,
with at least 48 hours since the first. Duplicate attempt IDs do not restart
the two-message allowance. A 24-hour studio/recipient cooldown spaces messages
across children. Historical automatic and desktop reminders count toward these
limits. Expired galleries, inactive studios, ambiguous identity, payment or
provider state, and uncertain delivery outcomes are held from sending.

Parents can delete an authorized unfinished checkout from Orders. The server
checks purchase email, private gallery access, every checkout member and current
Stripe ownership/payment state before expiring an unpaid checkout. It retains
the cancelled record for audit, persists the reminder stop, and excludes only
the marked unpaid cancellation from parent history. Paid, processing, refunded
and genuine submitted orders cannot be discarded through this control.

Every reminder includes a signed Stop reminders link. GET shows confirmation
without accessing or changing customer records; confirmed POST rechecks the
current order owner and recipient before saving a stop watermark. Tokens omit
plaintext email and PIN. Stopping an attempt does not cancel a paid order or
block a new checkout started afterward.

The automatic cron and desktop notification bridge call the same worker and
service-only transactional claims. Legacy force/cooldown options cannot bypass
eligibility. Each run claims at most 100 reminders and has a 45-second budget.
Unused leases can recover; attempted deliveries with unknown outcomes require
reconciliation instead of a blind resend. A provider idempotency key identifies
each scope/episode/stage.

## Release

This branch starts from the actual live production commit
`80ca6e236723d76d3656507633ac9ba3fe54acf2`, preserving its order-fee owner guards,
onboarding and gallery date behavior. It does not replace production with the
divergent main checkout.

Apply only `20261008010000_abandoned_cart_reminder_policy.sql` in a controlled
transaction and record that version in migration history. Do not push the
repository's divergent historical migration directory. The production build
uses read-only schema checks and refuses a missing reminder migration. Commit
the focused change, then use `npm run deploy:production`. Finally replace the
existing `notify-abandoned-cart` Edge source with the compatibility bridge,
retaining its JWT verification setting. The original source is backed up before
replacement.

Verification uses local PostgreSQL and provider fixtures for payment races,
claims, stops, delete→history reload, templates, token validation and desktop
compatibility. The real rendered parent UI and confirmation page are visually
checked. Production checks are read-only or malformed/unauthorized requests;
they must not send client emails or cancel a customer's order as a test.
