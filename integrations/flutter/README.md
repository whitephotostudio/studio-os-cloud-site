# Flutter V2 collage review bundle

The active desktop source is `/Users/harout/Downloads/Projects/studio-os-order-automation-v2-20260930`.
This separate directory had no Git metadata. The collage implementation is already
applied there; the older V1 checkout was preserved.

`collage-desktop-preview.patch` contains only the 20 task files: five modified
existing files and fifteen additions, including eight tests. It is a normal Git
patch against the captured active V2 baseline. `desktop-review-manifest.json`
records the original and implemented SHA-256 for every file. Original bytes also
remain in the separate local `studio-os-collage-desktop-backup-20261014` directory.
The companion local review repository is `studio-os-collage-desktop-review-20261014`;
its baseline is `d6934fc`.

Do not apply this patch again to the already changed active source. To review or
apply elsewhere, verify every modified file against `beforeSha256` first and
ensure each added path is absent. Use `git apply --check` before applying; stop
on any mismatch and preserve the newer source. Verify all resulting files against
`afterSha256`. The final bundle was applied to a temporary captured baseline and
all 20 output hashes matched the active source.

The native editor saves private Cloud drafts. Gallery publication and sellable
product/package setup are managed in Cloud. Purchased collage preparation uses
the server's finished pixels through the existing print workflow. Native price
sync preserves Cloud's collage item/category configuration while retaining the
existing price conflict policy.

The screenshot under `evidence/` uses a synthetic design in a Flutter widget test.
It is not an installed-app or live purchase test. See `verification.md` and the
Cloud `docs/collage-studio-preview.md` for validation and the rollout boundary.
No signed app was built, replaced or distributed.
