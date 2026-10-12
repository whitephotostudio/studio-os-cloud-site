# Encrypted Studio OS backup recovery

The USB drive contains encrypted customer data. It contains no plaintext photos,
gallery records, private RSA key, or photo master key. The restoration program and
this guide are safe to keep beside the encrypted files.

**The owner must keep the RSA private key in a second secure location outside this
USB drive and outside this Mac.** Use a password manager's secure document storage
or another encrypted device under the owner's control. Keep access to that secure
location separate from the backup drive. Do not email, text, publicly upload, or
place the private key unencrypted on this drive. Losing the only private key makes
the encrypted backup unrecoverable. This manual safekeeping step is still required.

The protected original key is `photo-manifest-private.pem` in the Mac's
`StudioOS_Security_Backups/2026-10-11_security_hardening` folder. Preserve the original
file and its permissions. The photo master key can be recovered from the RSA-wrapped
`key.enc` inside the photo backup, so retaining this RSA private key is sufficient.
Preserve a trusted copy of the verification receipts with the private key too.

## What is backed up

- The photo backup's ID folder contains the encrypted inventory, RSA-wrapped
  backup key, encrypted photo objects, authenticated resume records, and a
  verification summary. Object filenames are hashes and reveal no student names.
- `checkpoint-<ID>.enc` contains the database data checkpoint, schema/catalog
  evidence, preserved-record counts, provider backup evidence, source archive,
  and rollback SQL. Its encrypted index records the selected files and SHA256s.
- `checkpoint-<ID>.enc.verification.json` records archive and ciphertext SHA256s.
  A matching receipt also remains on the protected Mac.

The private key, raw/master keys, `.b64` files and live browser fixtures are excluded
from the checkpoint archive. Provider backup evidence records what the provider
reported at checkpoint time; the encrypted database checkpoint is the local copy.

## Verify and recover the checkpoint locally

Use Node.js 20 or later. Unlock the secure private-key location, copy the key into a
private folder on the Mac, and set that folder to mode `700` and key to mode `600`.
Choose the checkpoint filename and matching receipt on the backup drive. Prefer the
trusted receipt kept with the private key when checking authenticity.

```sh
node restore-checkpoint.mjs verify \
  --archive '/Volumes/2026-mini/StudioOS-Security-20261012/checkpoint-<ID>.enc' \
  --private-key '/private/Mac/folder/photo-manifest-private.pem' \
  --receipt '/private/Mac/folder/checkpoint-<ID>.verification.json'
```

A successful result includes `restoreVerified: true`. This decrypts and hashes in
memory; it writes no plaintext customer data. To recover the archive, use a new
private Mac directory:

```sh
node restore-checkpoint.mjs restore \
  --archive '/Volumes/2026-mini/StudioOS-Security-20261012/checkpoint-<ID>.enc' \
  --private-key '/private/Mac/folder/photo-manifest-private.pem' \
  --receipt '/private/Mac/folder/checkpoint-<ID>.verification.json' \
  --restore-dir '/private/Mac/folder/StudioOS-Restore'
```

The helper refuses plaintext recovery onto `/Volumes`. Extract the resulting
`.tar.gz` only inside a protected Mac folder. Check the encrypted archive's
`checkpoint-index.json` against the recovered files before using them.

## Recover photos and return to service

Keep `manifest.enc`, `key.enc`, the `objects` folder and verification files together.
The reviewed `scripts/security-photo-backup.mjs` code in the security release
contains the manifest and photo decryption format. Its verifier checks AES-GCM tags,
byte counts and SHA256s. Restore selected samples to a protected Mac location and
visually inspect them before planning a full recovery.

Have the developer restore into a separate private database and storage bucket
first. Validate galleries, original/cutout photos, orders, payments and download
access before switching production. Do not automatically replay rollback SQL or
overwrite production while checking a backup. Restoring this local archive does not
change any online gallery, order, photograph or provider setting.

The seven-day signed download URLs in the encrypted photo inventory are only for
creating or repairing the backup. Existing encrypted photos can be decrypted with
the retained RSA private key after those URLs expire.
