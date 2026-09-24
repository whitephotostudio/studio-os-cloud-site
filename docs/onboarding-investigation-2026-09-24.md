# Signup and activation investigation — September 24, 2026

## Finding

There is a confirmed onboarding defect in Studio OS Cloud. Five non-owner accounts were created without a Studio trial plan or explicit trial dates. The application leaves these incomplete profiles untouched and grants them zero desktop activation keys. For the four whose fallback trial is still running, the access response allows downloading the app but supplies no keys, and the dashboard suppresses its desktop welcome/download guide because the plan is missing.

This is a product defect, not evidence of a customer connection or computer problem. It can prevent desktop onboarding. The available records cannot establish why each individual stopped using the product, or whether they attempted a download.

## Production snapshot

Read-only inspection at approximately 13:05 America/Toronto, September 24:

- Eight registered accounts: six non-owner accounts and two platform owner accounts.
- Zero active paid subscriptions linked to photographer profiles. This was checked in the application database, not independently against the complete Stripe subscription inventory.
- All six non-owner accounts have confirmed email addresses and have signed in.
- The five newer accounts also accepted the photographer agreement.
- Five profiles have `subscription_status = trial`, but null plan, start, and end fields. All five have zero photography keys and zero key activations.
- Applying the application's existing trial-date fallback produces four active trials and two expired trials among the six non-owner accounts. The directory instead displays zero active, one expired, and five with “No trial.”

| Account | Stored plan | Trial according to existing fallback | Desktop keys | Observed usage |
| --- | --- | --- | ---: | --- |
| Joshua Poe | Missing | Active | 0 | Confirmed email, signed in, accepted agreement |
| Shimiko Phelps | Missing | Active | 0 | Confirmed email, signed in, accepted agreement |
| Mohammed Radhi | Missing | Active | 0 | Accepted agreement; one school and a successful school update |
| vkpk | Missing | Active | 0 | Confirmed email, signed in, accepted agreement |
| Divya Dugar | Missing | Expired | 0 | Confirmed email, signed in, accepted agreement |
| Cristian Pamfil | Studio | Expired | 2 | One desktop activation; last recorded key validation April 16 |

No non-owner currently has project, order, or student records in the inspected tables. This does not measure deleted records, local-only desktop work, every page visit, or every upload path. The available non-owner audit entry is successful; there are no recorded non-owner audit failures. Audit logging is not comprehensive request/error telemetry.

## Root cause

The live `on_auth_user_created` trigger calls `public.handle_new_user()`. Its current body creates a photographer using only `user_id` and the literal business name `My Photography Business`. It does not initialize the trial plan or trial dates.

`lib/payments.ts:589`, `getOrCreatePhotographerByUser`, immediately returns any existing profile at line 594. The code that assigns a Studio plan and a 30-day trial only runs when no profile exists. The database trigger already created one, so normal signups bypass that initialization.

Downstream effects:

1. `lib/studio-os-app.ts:204`, `getAllowedPhotographyKeyCount`, returns zero for a missing plan. The key synchronization routine consequently creates no keys.
2. `lib/studio-os-app.ts:336`, `resolveStudioAppEntitlement`, recognizes an active fallback trial for download access, but calculates included keys from the missing stored plan. These two decisions disagree.
3. `app/dashboard/page.tsx:888` requires a Core or Studio plan before displaying the desktop welcome guide, so these users miss the guide.
4. `app/api/dashboard/admin/users/route.ts:209` reads only an explicit `trial_ends_at`, while other application paths use `resolveFreeTrialEndsAt`. The admin directory therefore reports “No trial” for accounts that other paths consider on trial.
5. `app/dashboard/admin/users/page.tsx:876` labels the column “Last active,” but the API fills it from Supabase Auth `last_sign_in_at` at `app/api/dashboard/admin/users/route.ts:199`. It is a sign-in timestamp, not a reliable usage measure.

The intended entitlement is documented in `supabase/migrations/20260411100000_add_free_trial_columns.sql`: new users receive full Studio access during their trial, starting on the first dashboard visit after confirmation.

## Additional access inconsistency

Both the dashboard billing gate (`app/dashboard/page.tsx:754`) and desktop subscription helper (`lib/studio-os-app.ts:164`) treat the local status `trial` as active independently of its expiry. Local reproduction with Cristian's expired trial still permits desktop downloads and two keys. A correction must handle active and expired trials together; simply assigning Studio to every incomplete account would also enable expired accounts unintentionally.

## Verification

- Read production Auth confirmation/sign-in timestamps, photographer profile fields, the signup trigger definition, and aggregate agreement/key/activation/workflow/audit records.
- Executed the actual TypeScript implementations of the profile initializer, trial helpers, key allowance, and entitlement resolver locally against a read-only snapshot. Database calls in that execution were stubbed and external calls were disabled.
- Confirmed all five incomplete profiles are returned without initialization and receive zero keys.
- Confirmed the four active incomplete trials permit downloading but fail the desktop welcome eligibility condition.
- Confirmed that assigning a Studio plan in an in-memory comparison yields two allowed keys, including for an expired trial, demonstrating the need for an expiry-aware repair.
- No production account, subscription, trial, agreement, key, or email was changed. No deployment was performed for this investigation.

## Recommended correction

1. Initialize incomplete profiles idempotently after verified sign-in, with a single consistent trial policy. Preserve paid subscriptions, owner access, existing valid trials, and user-entered business details.
2. Make desktop key provisioning, downloads, dashboard access, and the admin directory use the same effective trial and plan rules, including expiration.
3. Repair the affected accounts with a documented trial-window policy. Decide explicitly whether users who lost access to this defect receive a fresh trial; do not silently reset all expired trials.
4. Label the existing directory timestamp “Last sign-in.” Add distinct activation/first-project/first-upload activity if real product usage is to be displayed.
5. Verify the complete fresh-signup → confirmation → trial → key provision → desktop activation path, including repeated/concurrent initialization, expired accounts, paid users, and owners, before release.

Only this investigation report was added. Application source and production state remain unchanged.
