# Supabase capacity upgrade — September 24, 2026

## Authorization and scope

The owner requested verification of the current bill and addition of the needed
capacity, following an estimate of roughly US$30/month for Pro with Small
compute. The affected project is `whitephoto-cloud`
(`bwqhzczxoevouiondjak`, US West 2), in the WhitePhoto organization. Its only
project was verified through the Management API.

This change selects Small compute (2 GB RAM). It does not change the Pro plan,
disk size, disk IOPS, storage provider, spend cap, application code, schema,
customer records, trials, refunds or email state.

## Billing verified before the change

- Organization plan: Pro, confirmed by API and the authenticated billing page.
- Base plan: US$25/month.
- Most recent paid invoice: August 24, 2026, US$28.25, marked PAID.
- Upcoming pre-change invoice: US$25 current costs, US$28.25 projected costs.
- Existing compute charges were offset by the included compute credit. The
  billing page labels this line Micro; the project had no explicitly selected
  compute add-on and the server reported about 411 MiB usable RAM. Supabase
  documents that legacy Nano instances on Pro are billed at Micro rates.
- New compute: Small, 2 GB, US$0.0206/hour (approximately US$15/month).
- Expected ongoing base cost: approximately US$25 + US$15 - US$10 credit =
  US$30/month before tax or other charges. The actual compute charge depends
  on hours in the billing period; the transition period is prorated. Do not
  confuse this estimate with a finalized invoice.
- Spend cap was enabled. This change does not disable it; a spend cap is not
  a hard limit on explicitly purchased compute.

## Evidence and preflight

The project was online but received a Disk IO Budget warning. Read-only checks
showed a 232 MB database and approximately 6.8 GB available on the data disk.
Server metrics showed about 411 MiB usable RAM and 543 MiB swap use. Across a
75-second sample, CPU IO wait was about 9%, with active swap-in/swap-out and
most IO on the system disk. This supports memory pressure as a contributor;
it does not prove the cause of every prior application error.

The exact burst-budget balance was not available in the metrics scrape.
Historical SQL statistics were cumulative over months, so they were not
treated as current traffic or proof that today's QA caused the warning.

The latest completed physical backup was verified at 2026-09-24 12:05:49 UTC.
The project was `ACTIVE_HEALTHY` immediately before the change. The API price,
target memory, current selection and recent backup were checked before the
single update request.

## Change and verification

- The Management API accepted `compute_instance: ci_small` at
  **2026-09-24 18:45:11 UTC** (14:45 Toronto).
- The selected add-on then reported Small / 2 GB and the project reported
  `RESIZING`.
- At 18:45:38 UTC, auth/metrics temporarily returned HTTP 521 during the
  transition; the independently hosted website returned HTTP 200.
- The project returned to `ACTIVE_HEALTHY` at **18:48:10 UTC**, approximately
  three minutes after the request. No second resize or manual restart was
  issued.
- At 18:48:39 and 18:49:48 UTC, auth health, metrics and the website sign-in
  page returned HTTP 200. Auth health is a service check, not a fresh real-user
  login test. Database reads succeeded in 131–185 ms from this machine.
- All eight existing photographer IDs are still present.
- The server now reports **1835 MiB usable RAM**, approximately **1171 MiB
  available RAM**, and **0 MiB swap use**.
- Across two distinct post-upgrade metric samples approximately 69 seconds
  apart, swap-in and swap-out were both zero. CPU IO wait averaged about
  **0.16%**, compared with about 9% in the earlier short sample. Combined disk
  traffic was approximately 0.29 MiB/s and 7 IO operations/second during the
  post-upgrade sample. These are short observations, not a sustained-load
  certification or a measurement of the exact remaining burst budget.

The capacity upgrade is complete and the immediate memory/disk pressure has
cleared in the verification samples. The deferred owner-overview work may
proceed. Normal usage should still be monitored for recurrence; no provider
or application-wide guarantee of zero future issues is implied.

## Provider assessment

The practical next step is to retain Supabase, verify the capacity change,
and evaluate observed performance. Migrating auth, access policies, database
functions and app integration would be a separate project. Photo uploads
already use Cloudflare R2.

The provider status page also listed an ongoing intermittent JWT-rejection
incident and a resolved lifecycle incident in EU West 1. The current project
is in US West 2; there is no evidence here that either incident caused the
customer's duplicate order. Extra memory does not fix provider-side auth
incidents or eliminate all application bugs.

Sources:

- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/compute-and-disk
- https://supabase.com/docs/guides/platform/manage-your-usage/compute
- https://supabase.com/docs/guides/troubleshooting/exhaust-disk-io
- https://status.supabase.com/
