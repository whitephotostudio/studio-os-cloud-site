# Riviera: Alkit fulfillment and GotPhoto migration

Evidence checked October 8, 2026. This document distinguishes an implemented
Studio OS workflow from a lab-approved integration. No email, lab order,
customer import or production photo change was performed for this investigation.

## Alkit: supported public facts and exact remaining contract

[Alkit ROES](https://www.alkit.com/alkit-roes) offers school/sports packages.
Its Records module imports CSV subject data, associates individual/group images
and can build products in bulk after the photographer verifies the table.
This supports investigating a CSV-to-ROES workflow with Alkit. It does not
publish the exact account catalog, CSV fields or unattended order-submission API.

[Alkit’s GotPhoto page](https://www.alkit.com/gotphoto) describes direct paid-order
handoff and home or school delivery. Studio OS has not established an equivalent
Alkit partnership or compatibility approval.

[Alkit file preparation](https://www.alkit.com/file-prep) specifies sRGB, 8-bit,
high-quality JPEGs and an embedded color profile. Its software handles sizing;
FTP submission needs prepared sizes. Color correction is included unless the
photographer requests the applicable alternative. The existing Studio OS
Noritsu RGB JPEG/ZIP profile is not proof of embedded-sRGB compatibility,
accepted package mapping or Alkit order acceptance.

No public API/authentication or exact FTP/CSV submission specification was found
in the inspected official pages. An interface may exist privately; its absence
from public documentation does not prove that it is unavailable.

Before developing a live adapter, obtain from Alkit:

- An approved route: ROES Records CSV, private API, or an account-specific upload
  method, with a real sample accepted order and credentials provisioned securely.
- Exact CSV/schema, lab product/package IDs, quantities, wallet units, cropping,
  bleed, resolution, image naming, ICC profile, color-correction and retouch flags.
- Shipment/address fields and choices for home vs. school/studio delivery,
  shipping charges, tax responsibility and account pricing.
- Duplicate-order/idempotency rules, lab acknowledgement/reference, rejected-order
  handling, cancellations, tracking and status reconciliation.
- A reviewed sample order that Alkit acknowledges, produces and fulfills before
  promising automatic fulfillment to Riviera.

Alkit’s published contact is [Customer Service](https://www.alkit.com/contact-us):
proimaging@alkit.com, (516) 379-1515. Contacting them is a separate authorized action.

## Implemented migration entry point

`/dashboard/migrations/gotphoto` lets a signed-in photographer select an owned
school, load a CSV, explicitly map columns, preview every source row and import
only reviewed new records. The API requires current authentication, MFA where
configured, school ownership and the legal agreement. No preview is persisted.

The service-only `import_reviewed_gotphoto_csv` database function creates either:

- Roster rows with a mapped stable source ID, first/last name, class/group and
  optional parent email. New private gallery PINs are generated; old GotPhoto
  access codes are not reused. Existing source IDs are skipped and preserved.
- Customer CRM records with mapped name/email and optional phone. Existing
  normalized emails are skipped, including archived/suppressed contacts. New
  contacts have unknown consent and contact disabled until reviewed.

A tenant-bound import ledger returns the original receipt for a repeated exact
request. Changed payloads cannot reuse that key. The transaction rolls back all
new rows and the receipt on a conflict or invalid row. Changed data after preview
requires another review. Existing originals, student edits, contact permission,
orders, paid status, invoices and pricing are never overwritten by this import.

Optional photo-folder review computes SHA-256 hashes locally, retains the relative
folder structure and validates an explicitly mapped exact filename per student.
Duplicate identities, duplicate/reused image paths, missing files, traversal and
ambiguous mappings block import. It offers a downloadable association manifest;
it does not upload or claim restoration of a complete multi-pose gallery.
Use the normal student gallery upload after reviewing these associations.

## What to export from GotPhoto

[GotPhoto Subjects](https://help.gotphoto.com/en/support/the-subjects-tab) exports
the names list, including GotPhoto child IDs and available contact data. Prefer
the actual child ID when present; manually resolve competing identifier columns.

[Student data export](https://help.gotphoto.com/en/support/run-a-student-data-export-pspa-and-custom-export)
offers PSPA/custom images and optional names-list CSV. It exports one selected
index image per subject; this is not a complete multi-pose gallery export.
Custom export can preserve original image size. Extract the downloaded folder,
retain subfolders and provide an explicit filename column rather than guessing
student-photo association from the displayed name.

[Buyers & Potential Buyers](https://help.gotphoto.com/en/support/the-buyers-and-potential-buyers-page)
exports customers as CSV or XLS. Choose CSV and map the real headers. It does not
establish marketing permission in Studio OS.

Pricing/package reconstruction, all original gallery poses, historical paid
orders, refunds, old links/access codes, invoices and consent evidence need their
own reviewed source contract and are not migrated by this tool. A synthetic
two-student, one-school fixture validates the implemented import; Riviera has
not provided a real export for customer-specific acceptance.

## Validation and release boundary

Executable tests cover CSV quoting/IDs, exact photo mapping, read-only preview,
owner/MFA gates, changed-preview rejection and retry reconciliation. PGlite runs
the actual migration function for imports, whole-batch rollback, separate-owner
isolation, duplicate conflicts, contact suppression and restricted privileges.
The schema-status RPC reads actual RLS/privileges for release preflight.

Production schema application, deployed page availability, a real one-school
export/import and subsequent gallery/photo review require separate evidence.
