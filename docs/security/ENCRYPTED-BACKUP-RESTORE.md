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
For photos, this includes `photo-backup-authenticity-receipt.json` from the
protected Mac folder. It records the trusted `manifestSha256` and
`keyEnvelopeSha256` for `manifest.enc` and `key.enc`. The key-envelope digest was
captured after decrypting it and comparing its master key with the protected
Mac master key. The USB copy is a convenience copy; a receipt obtained only from
the same USB drive cannot authenticate that drive's contents. Retain the trusted
receipt separately with the private key. RSA encryption alone does not establish
who created a replacement key envelope.

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

## Verify and recover selected photos offline

Keep `manifest.enc`, `key.enc`, the `objects` folder and verification files together.
The standalone `security-photo-restore.mjs` helper requires only Node.js 20 or
later and built-in Node modules. It performs no network requests, provider changes
or uploads. In a source checkout, run `node scripts/security-photo-restore.mjs`.
For the USB copy beside `restore-checkpoint.mjs`, use the full path shown below.

Take both digests from the separately retained trusted authenticity receipt.
Replace the placeholders with its `manifestSha256` and `keyEnvelopeSha256`.
The backup directory is the photo ID folder containing `manifest.enc`, not the
parent directory containing the checkpoint archive.

```sh
node '/Volumes/2026-mini/StudioOS-Security-20261012/security-photo-restore.mjs' verify-samples \
  --backup-dir '/Volumes/2026-mini/StudioOS-Security-20261012/<PHOTO-BACKUP-ID>' \
  --manifest-sha256 '<TRUSTED-manifestSha256>' \
  --wrapped-key-sha256 '<TRUSTED-keyEnvelopeSha256>' \
  --private-key '/Users/<your-Mac-user>/private-keys/photo-manifest-private.pem'
```

This verifies the first, middle and last inventory objects, counting each only
once. It authenticates the manifest, wrapped key, record MAC, object identity,
AES-GCM tag, byte count and SHA256, then discards decrypted photo bytes in memory.
Successful JSON reports `ok: true`, `objectsVerified` and `bytesVerified`. It checks
selected samples, so success does not establish that every other object is intact
or that an in-progress backup is complete. No original names, URLs or keys appear
in its output.

To recover one object, create a private folder on the Mac with mode `700`. The
private-key folder must also have mode `700`, and the key must have mode `600`.
Use physical paths without symlinked ancestors. Keep the key outside the photo
backup and off `/Volumes`.

```sh
mkdir -m 700 '/Users/<your-Mac-user>/StudioOS-Restore'

node '/Volumes/2026-mini/StudioOS-Security-20261012/security-photo-restore.mjs' restore-one \
  --backup-dir '/Volumes/2026-mini/StudioOS-Security-20261012/<PHOTO-BACKUP-ID>' \
  --manifest-sha256 '<TRUSTED-manifestSha256>' \
  --wrapped-key-sha256 '<TRUSTED-keyEnvelopeSha256>' \
  --private-key '/Users/<your-Mac-user>/private-keys/photo-manifest-private.pem' \
  --index 0 \
  --restore-dir '/Users/<your-Mac-user>/StudioOS-Restore' \
  --output 'recovered-sample.bin'
```

`--index` is a zero-based position in the encrypted inventory. Have an authorized
developer identify other desired positions privately when needed. `--output` is
an owner-chosen filename, with no directory components. The helper never uses an
original object key as a local path. Choose the extension appropriate to the
selected original when known; changing the filename does not convert its format.

Recovery refuses existing files, symlinks, non-private destinations, any plaintext
destination under `/Volumes`, and any destination inside the encrypted backup.
It streams to a mode `600` private temporary file, verifies the entire object,
then publishes the chosen filename atomically without overwriting another file.
Verification failures remove the temporary file and publish no photo. If the
process or Mac is forcibly stopped, an unverified `.studio-photo-restore-*.partial`
file can remain in that private folder; delete it rather than treating it as a
recovered photo. The CLI reports `restoreVerified: true` only for a completed,
authenticated object. Visually inspect recovered samples before planning a full
recovery. Keep recovered plaintext under the owner's access controls; folder
permissions do not establish whether the Mac's disk encryption is enabled.

## Return to service

Have the developer restore into a separate private database and storage bucket
first. Validate galleries, original/cutout photos, orders, payments and download
access before switching production. Do not automatically replay rollback SQL or
overwrite production while checking a backup. Restoring this local archive does not
change any online gallery, order, photograph or provider setting.

The seven-day signed download URLs in the encrypted photo inventory are only for
creating or repairing the backup. Existing encrypted photos can be decrypted with
the retained RSA private key after those URLs expire.
