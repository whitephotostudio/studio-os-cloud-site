# Security Patch 7 — Account Security Audit

Date: July 22, 2026 (EDT)

## Executive outcome

The production Studio OS website, booking flow, private student-media gateway, and installed Desktop app remained online during this audit. The initial review was read-only. After the findings were documented and backed up, the owner explicitly completed Cloudflare mobile TOTP authentication using Apple Passwords. No booking, payment, order, email, photo, database row, R2 object, deployment, environment variable, token, or password was changed.

No exposed live secret was found in the public website repository or its Git history. Private R2 access remains enforced and the existing post-switch production checks remain healthy.

Cloudflare owner two-factor authentication is active, recovery codes were saved privately by the owner, and backup-code reminders are enabled. Studio OS administrator TOTP is also now active for the primary owner account after the enrollment QR renderer was changed from an external service to local browser rendering. The next account-security work is the separately tested dependency update and later retirement of the older Cloudflare R2 token.

## Current healthy controls

- Cloudflare R2 Public Development URL is disabled.
- Direct public access to a known R2 object is denied.
- Authorized project, school, gallery, order-history, and composite media reads work through the private gateway.
- Anonymous image-proxy access is denied.
- The production home, booking, parent, and portal-choice routes return successfully.
- Booking availability remains available for the three active school dates.
- The installed Studio OS Desktop process remains running.
- Cloudflare mobile two-factor authentication is active for the owner account.
- Cloudflare backup-code reminders are enabled.
- Vercel reports MFA enabled for the only team owner.
- Vercel has one team member and one owner.
- Vercel production variables are stored as encrypted values.
- The public GitHub repository has one collaborator, who is the only administrator.
- GitHub secret scanning and push protection are enabled.
- The website `.env.local` file is ignored and is not tracked by Git.
- A high-confidence scan of the public repository history found no Stripe live key, Stripe webhook secret, Supabase service key, AWS access-key pattern, or private-key block.
- Supabase reports the production project as healthy.
- Supabase email confirmation is required for new application accounts.
- The Studio OS website already includes TOTP enrollment, verification, challenge, and removal support for application administrators.
- The primary Studio OS administrator now has one verified TOTP factor; Supabase reports zero unverified factors.
- Studio OS MFA enrollment QR codes are generated locally in the browser and are not sent to an external QR-rendering service.

## Prioritized findings

### Completed — Cloudflare owner two-factor authentication

State before the change:

- One Cloudflare account member is active.
- That member has Super Administrator access across the entire account.
- Cloudflare profile security shows Two-Factor Authentication as inactive.

Why it matters:

Cloudflare controls the private student-photo bucket and its access tokens. A stolen owner password without a second factor could expose or disrupt those services.

Safe change procedure:

1. Keep the current website and Desktop app running.
2. Open Cloudflare profile authentication settings.
3. Enroll an authenticator app and, if available, a second security key or backup factor.
4. Save recovery codes offline in a secure location before leaving the page.
5. Sign out and sign back in once to verify recovery access.
6. Re-run the production health and private-media checks.

Completion result on July 22, 2026:

- The owner enrolled the Cloudflare mobile TOTP method using Apple Passwords.
- Cloudflare now reports: `Mobile two-factor authentication is active.`
- Cloudflare reports that a TOTP method has been added to the account.
- Backup-code reminders are enabled.
- Post-change live checks passed: home HTTP 200, booking HTTP 200, parent portal HTTP 200, portal choices HTTP 200, and anonymous media gateway HTTP 401.
- The installed Studio OS Desktop process remained running.
- No live booking, payment, order, photo, database row, R2 object, deployment, token, or environment variable was changed by the MFA setup or verification.

The owner should keep the Cloudflare recovery codes offline and private. Recovery codes must never be included in source control, screenshots, support messages, or this report.

### Completed — Enroll Studio OS administrator TOTP

State before the change:

- Three Supabase application users exist.
- None currently has an enrolled MFA factor.
- The Studio OS website already supports TOTP MFA in dashboard settings and challenges enrolled administrators at sign-in.

Why it matters:

An administrator account can access student, booking, order, and media-management functions. TOTP reduces the effect of a stolen or reused password.

Safe change procedure:

1. Start with the primary owner account only.
2. Confirm the owner can receive account email and has a working authenticator app.
3. Enroll TOTP from Studio OS dashboard settings and complete the verification code.
4. Sign out and sign back in to verify the full challenge flow.
5. Record an account-recovery procedure before enrolling the remaining administrators.

Completion result on July 22, 2026:

- The external QR renderer was removed before enrollment because it would disclose the TOTP enrollment URI to a third party.
- Local QR rendering was added, tested, previewed, and deployed as Security Patch 8.
- The primary owner enrolled Apple Passwords and completed verification.
- The live UI reports MFA enabled.
- Supabase's dedicated administrator MFA endpoint confirms one verified TOTP factor and zero unverified factors.
- Public site, booking, parent portal, private-media denial, and Desktop health checks passed after the change.

### Priority 2 — Retire the older Cloudflare R2 token after verification

Observed state:

- Two Cloudflare API tokens are active for the `whitephoto-media` bucket.
- Both are bucket-scoped rather than account-wide.
- The newer token is named `studio-os-cloud-gateway-2026-07-21`.
- The older token is named `studio-os-cloud-site-2026-04`.
- Neither token has an expiration date.
- The production private-media gateway is currently healthy using the deployed configuration.

Why it matters:

Keeping an older credential active increases the number of credentials that could be copied or misused. The bucket scope limits the impact, but the unused credential should be removed once the active credential is conclusively identified.

Safe change procedure:

1. Preserve the current Vercel deployment and rollback reference.
2. Confirm the newer token is the one stored in Vercel production.
3. Re-run an authenticated production media read immediately before the change.
4. Revoke only `studio-os-cloud-site-2026-04`.
5. Immediately re-run booking pages, parent gallery, order history, Desktop gateway, and authenticated media-byte checks.
6. If any private-media check fails, restore a bucket-scoped token and update Vercel before making any other change.

Revocation is intentionally not part of this read-only audit because it can break live media access if the credential assumption is wrong.

### Priority 2 — Protect the GitHub `main` branch

Observed state:

- Repository visibility is public.
- Only one collaborator/admin is present.
- Secret scanning is enabled.
- Push protection is enabled.
- The `main` branch currently has no branch-protection rule.

Why it matters:

Branch protection reduces accidental force pushes or unreviewed changes to the production source. With one developer it is mainly a change-safety control, not evidence of a current data exposure.

Recommended policy:

- Block force pushes and branch deletion.
- Require successful build/security checks before merging when the deployment workflow is ready for it.
- Do not enable a rule that requires a second reviewer while there is only one collaborator, because that could block legitimate emergency work.

### Priority 3 — Clean local-only Flutter Git history before any future publication

Observed state:

- The Flutter repository has no remote configured.
- Its current active R2 credential file has been removed from the worktree.
- The retained backup file is sanitized and contains no R2 master credentials.
- Older local commits still contain the historical credential-shaped configuration.

Why it matters:

The history is not currently published, so this is not a public leak. It would become a risk if the repository were later pushed to GitHub or shared as a full Git bundle.

Recommendation:

- Keep the repository local until the old Cloudflare token is retired.
- Before publishing, create a clean source history or carefully purge the historical credential file.
- Never copy R2 master credentials back into a Flutter or other client application.

### Priority 3 — Resolve the stale local Stripe credential copy

Observed state:

- A read-only Stripe account request using the website project's local `.env.local` credential returned HTTP 401.
- No Stripe key value was printed or exposed during the check.
- Vercel production Stripe variables remain encrypted.
- No payment, checkout session, refund, or webhook setting was changed.

Interpretation:

The local key is likely stale, revoked, mismatched, or not the production credential. This does not by itself show that live payments are broken, because production uses Vercel's encrypted environment and the live site has already passed its operational checks.

Recommendation:

- Do not replace the production key based only on the local mismatch.
- During a controlled maintenance window, inspect the Stripe dashboard's active restricted/live keys and webhook delivery health.
- Remove the stale local value only after confirming a safe development credential and preserving the production configuration.

## Access items not conclusively verified

- Supabase dashboard-owner MFA could not be confirmed through the authenticated CLI. The browser requires a separate Supabase dashboard sign-in. This is distinct from Studio OS application-user MFA, which was inspected directly.
- GitHub owner-account MFA status is not exposed by the repository API used for this audit.
- Stripe dashboard-owner MFA and live webhook delivery history require an authenticated Stripe dashboard session.

These are follow-up account checks, not evidence that the production site is down or student media is public.

## Recommended change order

1. **Completed:** Enable Cloudflare owner MFA using Apple Passwords.
2. **Completed:** Confirm the Cloudflare recovery codes are stored offline and privately.
3. **Completed:** Enroll TOTP for the primary Studio OS administrator using a locally rendered QR code.
4. Test a full Studio OS sign-out/sign-in MFA challenge while recovery access is available.
5. Patch the audited production dependency advisories in a separate preview-tested change.
6. Confirm and revoke the older Cloudflare bucket token, with immediate private-media tests.
7. Verify Supabase, GitHub, and Stripe dashboard-owner MFA in their signed-in dashboards.
8. Add a safe GitHub branch-protection rule.
9. Clean local Flutter history before any future publication.
10. Resolve the stale local Stripe development credential without altering the working production key.

## Safety boundary

Every account change above should be done one at a time, followed by live read-only verification. Do not combine MFA enrollment, token revocation, environment-variable rotation, and deployment changes in one step. Keeping the changes separate preserves a clear rollback path and makes any problem immediately identifiable.
