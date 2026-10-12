# Studio OS security hardening — 2026-10-12

This is a bounded engineering review and implementation record. It is not a penetration-test certificate or a guarantee against compromise. The priority is to close confirmed access-control gaps while preserving existing photos, galleries, paid orders, printed QR labels, and ordinary parent access.

**Release status: in progress.** At this checkpoint the main production website still runs `fcf5613`. Security implementation commit `716a628` is being integrated with the current `origin/main` features; final integrated tests, production deployment, browser verification, and private-bucket cutover remain pending. Update this section from release evidence before calling the work shipped.

## Applied to production and checked

The following six SQL changes were applied individually against the inspected production catalog. Exact prior definitions, permissions, catalogs, and rollback SQL are retained in the protected local backup folder.

| Migration | Result |
| --- | --- |
| `20261012010000_enforce_session_mfa.sql` | Restrictive MFA checks on authenticated table/storage access and reviewed security-definer entry points; tenant policies still apply. |
| `20261012040000_legacy_storage_ownership_gateway.sql` | Frozen ownership records for legacy photo objects; editable media references cannot establish storage ownership. |
| `20261012050000_restrict_client_table_privileges.sql` | Removes unnecessary direct client privileges from server-managed tables. |
| `20261012060000_retain_r2_namespace_owners.sql` | Retains R2 namespace owners across resource deletion or alias changes. |
| `20261012070000_restrict_default_client_table_privileges.sql` | Prevents future tables from inheriting broad client grants. |
| `20261012080000_bind_r2_photographer_namespace_accounts.sql` | Binds photographer storage roots to the original account relationship. Read-only verification reported zero failures across 11 account bindings. |

Baseline preservation checks retained all 283 orders, 11,175 media records, 1,090 student records, and 2,514 legacy storage object identifiers. These counts establish preservation at the checkpoint; they are not a full disaster-recovery test.

Provider checks confirmed database SSL enforcement, GitHub dependency alerts/fixes and secret scanning enabled, Vercel owner MFA active, and GitHub owner passkey/authenticator MFA configured. Cloudflare and Stripe management MFA could not be checked because their browser sessions had expired. The owner deferred Supabase management-account MFA setup; it remains unfinished; application MFA and provider-account MFA are separate controls.

Legacy delivery Edge Function hardening was deployed as `e9f621a`. An unauthenticated POST returned HTTP 401 without sending email. This does not establish that the main website security changes are deployed.

## Implemented in source; release verification pending

| Area | Implemented behavior | Compatibility boundary |
| --- | --- | --- |
| Dashboard authentication | Provider-verified identity; enrolled MFA must complete before actionable user context is returned; privileged administrators must enroll; browser mutations check origin/fetch metadata. | Enrollment and challenge APIs remain reachable. Ordinary studio accounts without an enrolled factor retain the documented enrollment policy. |
| Parent PIN attempts | One durable attempt budget across portal context, favorites, order, yearbook, and download credential validators. Missing/unavailable shared counters fail closed for unproven credentials. Ambiguous duplicate GET credentials are rejected. | Successful validation issues a signed, HttpOnly, Secure production cookie for the exact gallery/PIN/email scope. It exempts repeated valid credentials from the PIN-attempt budget only; every route still performs its database authorization and action limits. Printed QR/PIN links remain supported. |
| Parent PIN recovery | Requires the student's trusted roster email, or a photographer-approved request bound to that student/studio/email; school-wide registration alone cannot recover a student's PIN. SQL LIKE metacharacters are escaped; recovery origins come from trusted configuration; tokens expire and are consumed once with a conditional database update. Previously issued tokens are rechecked against the current association. | Missing trusted contact details require photographer assistance. Recovery must not silently disclose another student's PIN. |
| Private media reads | R2 and legacy Supabase gateways validate a scoped, expiring capability or a fully authorized dashboard session, then verify retained storage ownership. Server-side photo readers validate ownership before native storage signing. | Historical Supabase/R2 references are adapted; capability query parameters survive browser URL normalization. Public studio branding/backdrops remain separate from private student media. |
| Uploads and tenant isolation | Reviewed uploads, path ownership, privileged mutations, and server-only media namespaces are bounded to the authenticated tenant. | Resource deletion does not allow a newly created alias to claim the old tenant's stored objects. |
| Browser security | Per-response nonce CSP, no production inline/eval script permission, dynamic nonce-bearing HTML, no-referrer on private gallery/portal/dashboard routes, and CSP-bearing public booking/manage scripts. | Stripe/Link frames and connections, supported YouTube embeds, image/blob/canvas previews, and booking behavior remain permitted by the configured policy. Live browser checkout still needs verification. |
| Delivery/payment boundaries | Scoped paid-delivery checks and fresh Stripe signature validation; legacy administration requires verified MFA. | Existing paid order/media bindings and normal purchase flows must pass final release checks. |
| Dependencies and secrets | Runtime dependency audit reported zero vulnerabilities; full-history secret scan found two dummy test values and no real credential match. | Five high-severity development-only findings remain in the unpatched `braces` dependency chain. A clean scanner result is not proof that no secret has ever been exposed. |

## Verification evidence at this checkpoint

- Integrated full regression suite after merging the shared gallery/order changes: **1,708/1,708 passed**, zero failures. Log: `/tmp/studio-os-security-merged-full-tests2.log`. An integrated production build passed; the final clean-checkout release guard will run both again before deployment.
- Additional access fixes prevent a school alias from impersonating CRM, booking-campaign, ZIP, or other server-managed storage roots. Actual SQL/resolver/upload tests cover foreign claims and valid existing paths. The storage-folder API honors retained roots for the original owner after relabeling.
- CSP diagnostics retain URL origins only, discard code samples/referrers/policy nonces, and bound input and log volume. Actual route privacy tests passed.
- Merged payment recovery retains provider proof and the shared payment lock, rechecks payment inside the lock, accepts legitimate verified zero-cost orders, and preserves canceled/refunded terminal states. Seventy-two focused recovery/payment tests passed. Read-only production preflight verified all worker tables, eight exact RPC bodies, trigger and restricted grants.

- Parent integration checks: **105/105 passed** after resolving the merge of security, watermark opacity, all-pose visibility, phone/tablet ordering, currency, and earlier photo-navigation speed changes. These exercise the actual extracted handlers/components and include recovery and PIN-proof regressions. Log: `/tmp/studio-os-parent-merge-review-tests.log`.
- Delivery/backdrop compatibility checks: **57/57 passed** before the latest `origin/main` integration. These assert owner-bound byte authorization, selected backdrop behavior, and refusal to substitute an unauthorized original. Log: `/tmp/studio-os-parent-delivery-harness-fixes-final.log`. Rerun against the final merged tree.
- Encrypted photo/checkpoint helper checks: **19/19 passed**, including malformed manifest rejection, signature/ciphertext tampering, streaming byte/SHA verification, resumability, physical key/destination separation, wrapped-key recovery, private permissions, checkpoint filtering, and local restore. Log: `/tmp/studio-os-backup-helpers-final.log`.
- Booking/manage route checks verify that the emitted script nonce matches the CSP response, invalid nonce input is replaced, distinct responses receive fresh fallback nonces, and no nonce-bearing HTML is publicly cached.
- Final clean-checkout release-guard results, deployed commit, authenticated production gallery/checkout checks, and browser CSP results have **not yet been recorded here**. The preceding focused tests do not substitute for them.

## Backup and cutover status

The fresh encrypted photo backup is running to `/Volumes/2026-mini/StudioOS-Security-20261012`. Its manifest inventories approximately 204.2 GB across 48,080 R2/legacy Supabase objects. At the reporting checkpoint it was incomplete; do not describe it as a completed backup or start the dependent legacy private-bucket cutover from this document.

Only ciphertext and nonsecret verification/restore metadata belong on that external ExFAT volume. RSA private keys, raw/master keys, plaintext signed URLs, browser fixtures, and plaintext customer records are excluded. The protected Mac folder is `/Users/harout/StudioOS_Security_Backups/2026-10-11_security_hardening`.

The checkpoint archive helper is prepared to seal the refreshed database checkpoint, source archive, catalog, provider-backup metadata, and rollback SQL beside the photo ciphertext. Creating the final archive awaits the fresh checkpoint/final source state. The helper decrypts and compares SHA-256 locally before reporting success. Photo backup completion also requires the helper's byte-count/ETag/SHA checks and sample decrypt/restore verification; an object count alone is insufficient.

Legacy `nobg-photos` and `thumbs` buckets remain public at this checkpoint. The reviewed private-bucket cutover and rollback SQL are present in `docs/security/2026-10-12-legacy-storage-private-cutover*.sql`, but the cutover has **not been applied**. Complete and verify the backup and deployed compatible gateway before applying it. Then verify anonymous denial and authorized gallery/order reads without changing customer photo content.

The owner must keep a second protected copy of the RSA private key outside both this Mac and this backup drive. Ciphertext cannot be recovered without that key. See [encrypted backup and restore instructions](ENCRYPTED-BACKUP-RESTORE.md). Provider backup availability was inspected; a complete provider/database/application disaster restore has not been performed.

## Explicit remaining risks and follow-up

1. **Parent credentials still appear in URLs.** Printed QR/PIN links, `/parents/[pin]`, recovery redirects, and some favorites/API query strings still carry PINs and/or email addresses. The new proof cookie is a rate-budget proof, not a replacement parent session. `no-referrer` reduces outbound referrer leakage but cannot erase browser history, copied links, screenshots, or provider/server URL logs. A separately tested one-time QR/PIN exchange into an HttpOnly parent session, followed by URL scrubbing and query removal, remains an architecture change. Existing printed labels must continue working through that exchange.
2. **First-time access shares an IP budget.** Many parents opening links for the first time on the same school Wi-Fi can briefly receive HTTP 429. Valid proof covers subsequent ordinary interactions. Monitor legitimate denial rates; adjust only while preserving a shared, durable guessing defense.
3. **Legacy public-bucket exposure remains until cutover.** Source fixes and ownership metadata do not make a public storage endpoint private. Verify the actual provider setting and an anonymous request after applying the cutover.
4. **Owner/provider access and restore readiness still need completion.** Finish Supabase management MFA and protect recovery codes/private backup keys. Record the final external-backup verification and perform a bounded provider/application restore rehearsal before claiming disaster-recovery readiness.
5. **This review is bounded.** No destructive live exploit, customer-photo download for testing, real order/payment mutation, or external penetration test was performed. Continued dependency updates, monitoring of denied access/CSP reports, provider-account review, and a professional penetration test add assurance beyond this patch.

## Release completion record — pending

Record final integrated commit and test/build results; guarded production deployment identity; live parent QR typing and navigation checks; authenticated gallery/favorites/order-history/checkout/delivery checks; CSP/Stripe browser checks; backup ciphertext verification; source/database checkpoint receipt; private-bucket cutover and anonymous/authorized checks; and final preserved-record counts. Keep secrets, signed URLs, student data, and recovery material out of this record.
