# Mac download release 0.1.10+14

The Mac download page shows the configured release version and now states the app's actual minimum requirement, macOS 13.5 Ventura. The current release is a universal Apple Silicon / Intel app signed with Developer ID and notarized by Apple.

The release configuration points to the immutable storage object:
`storage://studio-os-downloads/StudioOS-0.1.10-14-macOS-universal.zip`

Artifact: 94,604,939 bytes, SHA-256
`496de4b586f94a76827d71848e0106d76974b04b54c99f985d7d775b17df8fc0`.

The uploaded artifact was downloaded and its size and hash verified before the release row was updated. The previous storage object remains intact. Release state and Windows configuration were preserved.

The desktop release passed Flutter analysis, 693 tests, a universal Release archive, code-signature verification, stapled-ticket validation, and Gatekeeper assessment. The installed app launched successfully.

Changed website files:
- `app/studio-os/download/page.tsx`
- `docs/macos-download-0.1.10.md`

Website deployment uses `npm run deploy:production`, which requires a clean committed worktree and runs the website tests and production build.
