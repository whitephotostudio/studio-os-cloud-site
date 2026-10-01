# Private order-production routes

The separate Studio OS V2 app calls owner/MFA-protected order-automation upload,
quality and batch routes. Existing orders must be paid and owned. The quality
checker uses the OpenAI Responses API with gpt-4o, OPENAI_API_KEY on the server
only, structured judgments and conservative portrait limits. Missing evidence
holds orders. Purchased retouching needs human review.

Production ZIPs use the reserved order-automation R2 namespace, blocked from
generic R2 routes. Upload tickets verify private storage with a dummy-object
anonymous-read probe before customer uploads. Never disable the main gallery
bucket publicly without checking gallery routing. If privacy cannot be proved,
the upload stays held; do not bypass the guard.

Batches bind immutable ZIP SHA-256, exact order IDs, current financial revision,
recipient and message. Actual Noritsu archive checksums, sheet hashes, 300 DPI
geometry and internal quantities are verified. A per-cloud-order reservation
prevents competing stations from sending the same order. Provider receipts and
CAS states make retries reuse the same idempotency key and frozen email within
20 hours; old ambiguous sends require reconciliation. These receipts prove
provider acceptance, not lab acknowledgement.

Lab links expire after seven days, are token-protected, and recheck current
financial state. The cron deletes stale uploads after 24 hours and archives
after eight days, retaining delivery and reservation receipts. It does not send
mail. Local V2 performs scheduled production while its Orders workspace is open
and awake; preferences alone do not trigger server-side delivery.

The production prebuild guard verifies R2 privacy, verified Resend sender and
OpenAI model access if a key is present, without paid AI calls or sending mail.
A missing OpenAI key permits a manual-review release with automatic approvals
held. Set OPENAI_API_KEY as a Production Secret; no client key is exposed.
Physical address-label acceptance and live AI accuracy remain separate tests.
