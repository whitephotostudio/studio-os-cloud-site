# Flutter V2 collage review bundle

The active desktop source is `/Users/harout/Downloads/Projects/studio-os-order-automation-v2-20260930`.
It has no Git metadata. Collage changes are applied there; V1 is preserved.
Concurrent unrelated photo-edit watcher work appeared in the active source during
final validation and was left untouched. The reviewed, runnable collage snapshot
is `/Users/harout/Downloads/Projects/studio-os-collage-desktop-stage2-validation-20261014`.
It restores the captured pre-concurrent-edit task files and overlays only this
feature's changes; `desktop-review-manifest.json` records its exact scope.

`collage-desktop-preview.patch` contains 26 task files: five modified existing
files and 21 additions, including ten unit/widget test files and the isolated
native HTTP acceptance driver. It is a normal Git patch against the captured
V2 baseline. The manifest records before/after SHA-256 values for every file.
Original bytes remain in `studio-os-collage-desktop-backup-20261014`; the before-
stage-two bytes are in `studio-os-collage-desktop-stage2-backup-20261014`.
The companion local Git repository is `studio-os-collage-desktop-review-20261014`,
with baseline `d6934fc` and focused implementation commits recorded in the manifest.

Do not apply this patch again to the already changed active source. To apply
elsewhere, verify each modified file's `beforeSha256` and ensure added paths are
absent. Use `git apply --check`; stop on any mismatch and preserve newer work.
After applying, verify all files against `afterSha256`. The bundle is checked by
applying it to the captured baseline and comparing every output hash and mode.
Active source can differ because of the preserved concurrent work.

The native editor saves private local/Cloud drafts and can now publish a priced
standalone collage product or a mixed print package to selected galleries.
Publication uses an immutable version, exact cents, included copy count, the
reviewed catalogue revision and a durable retry receipt. It preserves ordinary
contents and rejects unrelated, stale or malformed receipts before updating
local catalogue prices. Cloud-only products remain intact during desktop sync.
Withdrawing gallery availability preserves paid orders.

Paid collage preparation uses the server's exact finished pixels through the
existing Noritsu staging workflow. The isolated acceptance driver published via
the real native commerce controls, then consumed the same browser-paid order
through the real production service and JPEG encoder. No printer was invoked.

Screenshots use synthetic designs/photos in Flutter widget tests. These are
source-level UI checks, not an installed signed-app verification. See
`verification.md` and `docs/collage-studio-preview.md` for the provider boundary
and final results. No signed app was built, installed, replaced or distributed.
