# Private paper and sheet drafts

The isolated lab pilot includes a separate visual sheet workspace. It creates TEST sheets from private uploaded originals. A draft never changes a school's prices, a package's ordered contents, a production job, a payment, a connector dispatch or a printer queue.

Choose paper first: 4 × 6, 5 × 7, 7 × 10, 8 × 10, 8 × 12 or 12 × 18 inches, with a separate paper orientation. Then choose a compatible layout. The available layouts contain one 8 × 10, two independent 5 × 7 prints, one 5 × 7, four independent 2½ × 3½ wallets, or one 4 × 6. Finished print dimensions stay exact when a larger paper is selected. The layout is centered with white unused paper; it is never shrunk to fit. This first version has fixed layout positions, without custom paper, gutters, bleed or whole-layout rotation.

Each cell has its own photo and manual crop. Coordinates refer to the EXIF-upright original, in whole pixels; the selected quarter-turn rotation follows the extraction. A crop must match the cell's aspect ratio within 0.2% and retain at least 200 source pixels per printed inch. The server generates the sheet at 300 pixels per inch. Selecting a photo alone does not approve a crop or a sheet.

Save the cloud draft, prepare its server proof, inspect the reduced proof of the actual saved JPEG, and explicitly review that exact render. Only then can its full JPEG and JSON manifest be downloaded. Any saved edit clears the current render and requires a new proof and review. Copies, from 1 to 10, are recorded in the manifest; the download is a single sheet image and does not send any print command.

The photographer's general sheet library uses the 20 newest uploaded originals plus the selected saved draft's older photos. A job-specific sheet can use only the originals currently assigned to that job's three print slots. A lab operator needs the exact assigned job, an active receiving role and the portal's two-step verification. A viewer cannot create sheets. Drafts are private to their creator rather than shared across a lab. Access and source scope are checked again when rendering, reviewing and downloading.

## Additive API and storage

Types, strict action validation and physical geometry live in `lib/labs/sheet-layouts.ts`. Server file rendering and scope checks live in `lib/labs/sheet-layout-server.ts`. Both authenticated route families use `lib/labs/sheet-layout-http.ts`:

- `/api/dashboard/lab-sheets`: photographer workspace.
- `/api/lab/sheets`: lab receiving workspace.

Every route is gated by `isLabPilot()`, trusted origin, current account authorization, applicable MFA and fail-closed rate protection. All responses have private no-store, no-referrer and noindex headers. There is no public bearer gallery or parent endpoint for sheet drafts.

`GET` returns `{ok, workspace}` with optional `jobId` and `draftId`. The general library and job-specific draft lists remain separate. Original preview requests use `file=preview`, `assetId` and optional `jobId`. Saved files use `file=proof|jpeg|manifest`, `draftId` and `renderId`. A proof is a reduced JPEG, not an unreviewed full-resolution download.

The strict POST actions are:

- `save`: client-generated `draftId`, `requestId`, `expectedVersion` (zero for creation), immutable `jobId` association, `name`, and `document`.
- `render`: `draftId`, retained `requestId`, and `expectedVersion`.
- `review`: `draftId`, exact `renderId`, `expectedVersion`, and the saved render's `sha256`.

Each action returns `{ok, draft, replayed}`. Exact retained retries recover their result. Changed payloads or stale versions fail without overwriting existing bytes. Only the current render for the current draft version can be reviewed or downloaded. Uploaded bytes use deterministic request identities and no-overwrite storage. An ambiguous database transport failure preserves bytes for reconciliation, since a missing registration read cannot prove the original transaction will never commit.

Migration `20261016080000_lab_sheet_layouts.sql` adds only `lab_sheet_layout_drafts`, `lab_sheet_layout_exports`, their new service-only RPCs/helpers and a separate private `lab-sheet-layout-files` bucket. Direct writes are revoked. Creator reads use RLS, and lab draft reads also require AAL2 and current receiving access. Export rows and their exact source hashes/crops are immutable; only the initial review timestamp and actor can be added. Limits are 60 drafts per creator, 20 renders per draft and 4 MB per JPEG, with at most 19.44 megapixels for a 12 × 18 sheet. Original assets remain in their existing immutable registry and private bucket.

The manifest records physical paper and pixel geometry, fixed cell positions, each cell's source checksum and crop, output checksum, copy count, review time and explicit `testOnly:true` / `printAllowed:false`. It deliberately has no printer profile, hot-folder path, commercial price or dispatch instruction. The existing production order and connector pipelines remain independent.
