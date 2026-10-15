# Studio OS lab directory and price sheets

The first module is a native Cloud workflow with no ROES code or transport. Photographers find listed labs by country/city, choose a lab, and save price sheets containing products, retail prices, packages, shipping preferences, terms and draft gallery selections. Administrators can add worldwide labs; administrators and provisioned lab owners can import catalog files.

## Routes and storage

- `/dashboard/labs`: photographer workspace in the existing dashboard.
- `/dashboard/labs/catalog`: catalog onboarding, CSV/TSV column mapping, preview and import receipts.
- `/api/dashboard/labs`: authenticated, owner-scoped workspace and compare-and-swap draft operations.
- `/api/dashboard/lab-catalog`: enrolled-MFA administrator/lab-owner catalog API.
- `20261015200000_lab_price_sheets.sql`: additive lab, catalog, membership and price-sheet tables; owner RLS; service-only mutation functions.
- `20261015210000_lab_catalog_imports.sql`: additive catalog versions/import audits and atomic idempotent import.

Apply migrations in order only after a hosted rehearsal and reviewed release. This change does not apply a migration or change provider configuration by itself. A missing schema produces a visible setup error and never pretends a draft saved.

## Catalog contract

CSV/TSV files contain up to 2,000 products and 2 MB. Download the sample template in the importer or use these headings:

```csv
sku,name,category,size,finish,wholesale_price,currency,popular
YOUR-4X6-LUSTRE,4x6 Print,Prints,4x6,Lustre,2.40,CAD,yes
```

The sample is illustrative, not a lab quote. Supported categories are prints, fine art, canvas and metal. Map either a size such as `8x10` or separate width/height columns, explicitly in inches. Files using other units must be converted first. Prices are decimal major units; storage uses exact integer currency minor units (the existing `costCents`/`retailCents` names also cover zero/three-digit currencies). No currency conversion occurs. Missing currency cells use the lab currency; mismatching codes or currency symbols are rejected.

An import adds/updates products by case-insensitive, trimmed SKU. Matching products retain their IDs; absent uploaded SKUs are retained. Screenshot reference products are retired on the first file import. Existing photographer retail prices/packages are never recalculated by an import. Retired selections remain visible for explicit review/removal. Active or previously verified lab catalogs require a separate versioned rollout; this draft importer refuses to replace them.

Uploaded products remain unverified. GTA is seeded in setup with visibly labeled screenshot reference costs and no approved production SKU. No fictional labs are seeded outside the disposable test fixture.

## Production and payments boundary

Publication is unconditionally held in the HTTP API until native checkout, shipping/terms, asset/crop validation, lab acceptance, production receiving and refund handling have a verified integration. A service-only SQL mapper exercises future immutable package/profile creation in tests; it is not a live release switch. Both existing single and combined customer-order handlers independently reject lab-marked products before writing an order. Ordinary studio products continue through their existing paths.

This module does not send email, submit orders to GTA, print, charge a card, collect a new fee or alter existing provider settings. Gallery selections and shipping/terms are saved **draft preferences** and do not change a live gallery. Digital delivery remains with the existing gallery product workflow. Lab memberships cannot be self-granted from the browser.

## Verification and local preview

```sh
npm test
npx tsc --noEmit
npm run build
node scripts/lab-system-fixture.mjs --app
```

The fixture serves only on loopback with synthetic Auth and actual PGlite migrations. It refuses production environment files and launches the unchanged Next app with a restricted synthetic environment. Use `http://localhost:55472/sign-in?redirect=/dashboard/labs`, because the ordinary origin guard rejects the alternate `127.0.0.1` browser origin. Synthetic accounts:

- `owner@lab.example.test`: ordinary photographer.
- `admin@lab.example.test`: platform administrator with a synthetic completed MFA assurance level.
- Password for both: `LocalLabOnly123!`.

```sh
LAB_SYSTEM_HTTP_ORIGIN=http://localhost:55472 node --test tests/lab-system-flow.test.mjs tests/lab-catalog-flow.test.mjs
```

These exercise real Next handlers, Auth checks, SQL, row-level permissions, version conflicts, atomic catalog uploads, safe retries, wholesale privacy and activation holds. Browser acceptance also covers price save/reload, a mixed-size package, country/city filtering, lab creation and file-picker import. All data is synthetic; test receipts do not prove provider delivery or physical output.

## Next integration milestone

Implement a separate immutable production-job/receipt ledger and one supported receiving adapter, validated through the lab's actual workflow. Tie approved media versions and crops to each job. Reconcile payment/retouch holds, acceptance, cancellation, reprints and shipments before lifting checkout/publication holds. Verify supported payment country/currency routes separately from worldwide directory listings. Any commission model remains a commercial decision; no new fee is enabled here.
