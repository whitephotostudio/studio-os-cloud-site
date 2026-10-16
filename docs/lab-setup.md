# Private lab setup

`/lab/setup` is the lab owner's preparation screen. It is available from the lab receiving portal, the photographer workspace and the isolated pilot instructions. The selected lab's existing membership controls access; the screen does not create lab memberships.

Owners can prepare a country-specific offering, upload a CSV/TSV product catalog, define paper sizes in inches or millimetres, choose accepted individual/composite files, state whether the lab offers cropping and colour correction, and choose collection/shipping destinations. Product-to-paper and input-format choices belong to exact uploaded product codes.

## Preparation and review

Saving creates a private versioned draft. Uploading stages the original catalog and its normalized product rows separately from the current catalog. Submitting marks the saved proposal as awaiting review; it does not publish the proposal or approve an offering.

No setup operation writes to current schools, packages, photographer price sheets, gallery prices, existing order snapshots, the active lab catalog or the approved country-profile registry. No operation changes intake, catalog verification, payments or printer connections. Real GTA Imaging orders remain disabled.

The existing catalog import screen remains separate. That older screen can import into an inactive setup catalog and holds replacement of an active catalog. The new setup screen stages proposals even for an active lab, allowing review without replacement.

## Operational boundary

This screen records what a lab proposes to support. A reviewed, exact current catalog and approved country profile are still required before those options can be offered to photographers as confirmed. Live fulfillment additionally needs an authorized production connection and operational validation. Selecting cropping or colour correction here records an offered service; it does not itself crop or colour-correct photos.

Catalog CSV/TSV dimensions currently use inches, with explicit guidance in the template. Paper sizes can use exact inches or millimetres. An individual-file product needs an exact paper candidate; larger fitting candidates can also be proposed for composite sheets. Orientation is explicit. An unrepresentable unit conversion keeps the original dimensions for manual review instead of silently rounding.

A proposal can state an ISO catalog currency for a future market. The staged CSV must use that same currency. This does not change the lab's current currency, convert money or alter the legacy one-currency-per-lab price-sheet contract; a proposal in a different currency needs reviewed price-book support before publication.

The original file is bounded to 2 MB and 2,000 products. The UI previews the first 50 valid rows and 100 issues; submission checks the full staged catalog. A proposal can select up to 500 exact product codes and 50 paper sizes. Products beyond the preview can be added by their exact code. Catalog uploads with issues can be staged for correction but cannot be submitted as ready. The isolated pilot caps each lab at 30 staged catalogs and 1,000 setup revisions; a wider rollout needs an operational retention and review workflow.

## Access and storage

The page and `/api/lab/setup` are enabled only in the isolated pilot. Existing lab members need two-step verification to read their lab's setup. Only an active owner membership can save, upload or submit; operator, viewer, photographer and platform-administrator status alone cannot write or gain access to another lab.

The additive `20261016100000_lab_setup_drafts.sql` migration creates a current draft, immutable catalog uploads and immutable revision history. It seeds no records and updates no existing tables. A service-only RPC rechecks current owner membership, serializes updates by lab, compares the expected version and records a unique request receipt. Exact retries confirm the latest head without repeating an upload or submission. Changing a retained request conflicts. Saving after submission creates a new draft revision while retaining the previous submission.

Pending browser requests are scoped to both account and lab and retained for retry. Sign-out or account changes clear the visible workspace. A lab switch or reload asks before discarding local edits. A failed schema load does not fall back to writing an active catalog.

The additive `100100` and `100200` conflict-response migrations preserve the existing function bodies and grants while returning final business conflicts as `PT409`. Custom `40001` errors trigger an automatic retry loop in the pilot's PostgREST version. Setup, sheet-layout and country-profile conflicts therefore return promptly as HTTP 409. These patches change no stored rows or previously applied migrations.

The pilot remains isolated from the main Studio OS database. Use the supplied sample lab owner account for testing; GTA has no connected owner account or confirmed current catalog. Do not add permission grants or fictional GTA data to make a demonstration appear live.
