# Trial onboarding repair

Confirmed sign-ins now complete placeholder photographer profiles through a service-only database function. The function locks and rereads the account, checks email confirmation, starts a 30-day Studio trial exactly once, and preserves existing expiry dates, paid subscriptions, cancellations, owner access, and custom business names. Unconfirmed accounts cannot initialize a trial.

A shared access module now controls dashboard, gallery, desktop and directory trial decisions. Active free trials include Studio and two keys, expired trials cannot download or activate, and concurrent initial requests reuse the same keys. UTC timestamps from legacy profiles have the same meaning in every browser timezone. The directory labels its existing auth timestamp **Last sign-in**. Signup waits for confirmation before claiming a trial is ready.

The owner explicitly approved fresh 30-day trials for the five affected accounts. `scripts/recover-trials-2026-09-24.sql` is a one-time, transactional operation limited to those five IDs. It requires confirmed, incomplete, unpaid, non-owner profiles with no keys, provisions exactly two keys each, and records before/after trial values in the audit log. Unexpected changes or replays abort the entire recovery. It does not send emails or alter orders, payment amounts, or the unrelated expired trial.

## Validation

309 website tests pass, including eleven new executable access and database cases. Coverage includes unconfirmed and confirmed signup, missing and trigger-created profiles, repeat and concurrent initialization, current/expired/invalid trials, paid/owner/canceled access, role permissions, key provisioning, real activation/validation logic, expiry suspending device use, and atomic/replay-safe account recovery. TypeScript passes; targeted lint has no errors and three pre-existing unused-variable warnings.

## Files changed

- `lib/subscription-access.ts`: shared trial dates, effective plan and access policy.
- `lib/payments.ts`: compatibility exports and atomic profile initialization.
- `lib/studio-os-app.ts`: consistent key allowance/download access and concurrent provisioning.
- `lib/subscription-gate.ts`: gallery access uses the shared policy.
- `supabase/migrations/20260924190000_initialize_photographer_trials.sql`: verified, serialized service-only initialization.
- `app/dashboard/page.tsx`: initializes placeholder accounts before the access gate and welcome guide.
- `app/api/dashboard/admin/users/route.ts`, `app/dashboard/admin/users/page.tsx`: consistent trial counts and last-sign-in label.
- `app/sign-up/page.tsx`, `app/auth/callback/page.tsx`: accurate confirmation/setup messages.
- `tests/trial-onboarding.test.mjs`: database, access and activation regression tests.
- `scripts/recover-trials-2026-09-24.sql`: bounded, audited account recovery.
- This release note; the earlier investigation report remains a record of the pre-repair state.

## Release

Pending production migration, guarded deployment, account recovery and live verification. The previous website deployment is `dpl_HRpNXzuPQ2DfxrpcMwCT9VDqYmD3`. The new function is additive and compatible with that version; recovery grants valid Studio trials that the previous version also understands. Do not roll back restored trial windows or delete issued keys as part of a website rollback.
