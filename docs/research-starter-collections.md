# Built-in print collections: research and implementation

Reviewed October 15, 2026. These are original Studio OS starting points based on products **commonly offered in published studio menus**. Public menus do not establish parent favourites, conversion rates, best-selling packages or a representative worldwide average. Some menus are dated 2025; an available menu does not establish a current quotation.

## Published menus reviewed

| Primary source | Market / useful observation | Interpretation boundary |
| --- | --- | --- |
| [Imperial Photo school packages](https://imperialphoto.ca/schoolphotopackages) | Canada; a small two-5×7 option alongside wallet combinations. | Wallet pieces and sheets cannot be interchanged. |
| [Volkan Photography pricing](https://www.volkanphotography.com/pricing) | Canada; individual 5×7 and 8×10 offers, with class photos separate. | Class-photo image selection is distinct from the individual portrait. |
| [Berg Media school sessions](https://www.bergmedia.ca/school-photo-sessions) | Canada; two 5×7 prints recur in a small package with wallets. | Duplicated or inconsistent offers were not copied. |
| [Sandbox Photographers school pricing](https://www.sandboxphotographers.com/school-pricing) | United States; a 2025 menu mixes prints, class photographs, digitals and gifts. | A mixed menu does not make every component an ordinary print. |
| [Chris O’Neil sports pricing](https://www.chrisoneilphotography.com/all-sports-pricing-2025) | United States; one 8×10 plus one 5×7 and wallets in an entry package. | Sports/team image roles and wallet layout require their own specification. |
| [Leeds schools](https://leeds.photos/schools/) | United Kingdom; mounted products and 10×7 dimensions. | 10×7 is not 10×8 or 8×10. Mounting cannot be silently substituted. |
| [Forever Timeless school and nursery guide](https://www.forevertimeless.co.uk/school-nursery-price-guide) | United Kingdom; mounted variants and miniature products. | An unspecified mini-print size is not a production specification. |
| [LC Photo school portraits](https://www.lcphoto.com.au/school-portraits) | Australia; a studio’s individual school portrait offer. | Individual studio work is not a volume-school price benchmark. |
| [Rapid Focus Media pricing](https://www.rapidfocusmedia.com.au/pricing) | Australia; an essentials structure includes one 8×10 and two 5×7 alongside wallets, a group photo and digital content. | Only the ordinary-print structure informs the pilot; group, wallet and digital components are excluded. |
| [MIT Photography packages](https://www.mitphotography.ca/pricing-packages) | Canada; one 8×10 with two 5×7; two 8×10 with four 5×7; and one 11×14 with two 8×10 and four 5×7. | Session-inclusive prices are not standalone lab-product prices and were not reused. |
| [Key West Photo portrait packages](https://www.keywestphoto.ca/portrait/sessions/photo-go-packages) | Canada; packages distinguish one, two or three selected images. | Image choices differ from physical print quantities. |
| [Julian Austin studio print prices](https://www.julianaustinphotography.co.uk/studio-print-prices/) | United Kingdom; individual sizes and canvas offerings. | Preserve exact dimensions; canvas is not an ordinary paper print. |
| [Rebecca Holmes portrait mini-session menu](https://www.rebeccaholmesphotography.com/wp-content/uploads/2025/09/Portrait-Mini-Session-Price-List.pdf) | United Kingdom; two 5×7 and one 8×10 alongside digital content. | Dated document, and a session offer; no price copied. |
| [Ivey Studio senior products](https://www.iveystudio.com/senior-products) | United States; current menu includes one 8×10 and two 5×7 with wallets. | Search snippets can show old pricing; the current page takes precedence. |
| [John Creighton pricing](https://www.johncreightonphotography.com/pricing1) | United States; family print combinations include 8×10, 5×7, 4×6 and wallets. | Studio OS Family Sharing is an original print-only combination, not a reproduction of this menu. |
| [Gianni Photography pricing](https://www.gianniphotography.com.au/pricing/109778) | Australia; lustre print combinations include 5×7, 8×10 and 12×18. | Larger-paper variants remain distinct sizes. |
| [Hannah Gilbert family information](https://www.hannahgilbert.com.au/family-info) | Australia; gift choices include ten 5×7 or four 8×12 prints. | Quantity does not specify how many distinct image selections are included. |
| [WHCC sports photo-print specifications](https://sports.whcc.com/products/photo-prints) | Lab documentation distinguishes two-, four- and eight-up wallets. | Confirms the need for explicit sheet/piece semantics before wallet templates. |

No competitor selling price, portrait-session fee, wholesale quote or currency conversion is used in the implementation. The research supports useful starting structures; photographers determine their own prices and suitability.

## Starter library, version 1

- **Everyday prints:** individual 4×6, 5×7, 8×10, 8×12, 11×14 and 16×20.
- **School print collections:** Small = two 5×7; Classic = one 8×10 plus two 5×7; Sharing = two 8×10, four 5×7 and four 4×6.
- **Portrait Essentials:** one 8×10 plus two 5×7.
- **Family Sharing:** two 8×10, four 5×7 and four 4×6.
- **Gift Prints:** ten 5×7.
- **Wall & Gift:** one 11×14, two 8×10 and four 5×7.

Dimensions are inches. These are unframed, individual paper prints. Wallets, mounts, class/team images, digital delivery, collages and specialty gifts are deliberately described separately until their exact sell unit, media and image-role contracts exist. The patterns are editable drafts and do not imply a particular number of different client image choices.

## Shared implementation contract

`lib/labs/starters.ts` contains the bundled, versioned definitions and a pure matching/pricing resolver. The browser renders its library before the authenticated catalog request completes; browsing never requires an existing catalog or a network lookup. `workspace.starterCollections` also exposes the same compact definitions to native clients.

Creation extends the existing request without changing older `popular` or `blank` requests:

```json
{
  "action": "create",
  "labId": "88888888-8888-4888-8888-888888888888",
  "name": "My Portrait Collection",
  "starter": "blank",
  "templateId": "portrait-essentials",
  "templateVersion": 1,
  "finish": "Lustre",
  "markupPercent": 100,
  "rounding": "0.99"
}
```

The sample lab ID is a disposable local fixture, not GTA. The server selects the template and recomputes every match and price using current catalog records. Browser-supplied catalog costs, verification grants or assignments are not accepted.

An eligible product belongs to the chosen lab and currency, is active and verified, has a real nonblank SKU and a confirmed integer cost, and has explicit `printsPerUnit: 1` metadata. Category, exact dimensions and explicitly selected finish must match. Reversed dimensions represent the same ordinary print size; similar aspect ratios and neighbouring dimensions do not. Products labelled as sheets, wallets, pairs/packs, mounted/framed work, class/group/team images or other special units are also rejected. Product names cannot establish a sell unit: absent or multi-print counts are unavailable even when a name resembles an ordinary print.

The additive `20261016020000_lab_catalog_sell_units.sql` migration adds nullable `studio_lab_catalog.prints_per_unit`, checked from 1 to 100, with no historical backfill. The optional CSV heading `prints_per_unit` maps to `printsPerUnit` in the shared API. Imported counts remain unverified. Updating a catalog row always resets approval and explicitly replaces its count; a blank/missing count clears a prior value rather than preserving stale single-print assumptions. The existing importer still holds active/verified catalogs for a reviewed rollout. This migration recreates only the existing catalog-import RPC for the added metadata and preserves its grants, scope, version/idempotency checks and atomic behavior.

The preview shows matched, missing, unverified and ambiguous requirements. Two eligible SKUs for the same requirement stay unresolved rather than selecting the first. A missing package component means the **entire package** is unavailable; its remaining components are never offered under the original package name. Available individual sizes can form a new draft with the complete available packages. Creation is blocked if no size resolves. The complete blueprint remains browseable in all cases, including GTA’s unverified reference catalog.

The selected markup applies to confirmed costs. Package retail is calculated from its whole constituent cost, then rounded once; it is not a sum of independently rounded retail amounts. Supported currencies retain their actual integer minor units, including JPY and three-digit currencies. No FX conversion or universal market retail price is inferred. The default 100% markup is an editable initial setting, not a profitability recommendation. All resulting prices and packages remain editable.

The new action saves through the existing owner-scoped draft RPC. It creates a new sheet with empty assignments, never merges into an existing sheet, changes a school, reprices an old package or enables checkout. GTA intake and publication holds remain. The starter definitions themselves remain bundled code; the additive catalog sell-unit column supplies the explicit production-unit metadata needed to resolve them safely.

## Verification

`tests/lab-starters.test.mjs` covers exact matching, ambiguity, unverified references, category/finish/sell-unit exclusions, missing components, all collection quantities, currency precision, invalid input/overflow, static pre-catalog rendering and the real backend with actual PGlite migrations. The backend test creates, edits, saves and reloads a new sheet, rejects stale writes, checks earlier draft prices, verifies legacy school/package/order snapshots remain unchanged and checks GTA/publication holds. An optional actual Next HTTP test runs when `LAB_SYSTEM_HTTP_ORIGIN` points at the isolated loopback fixture.

The bundled library removes per-template network requests and uses a local indexed matcher. The existing workspace still loads the bounded global directory/catalog; this change does not establish worldwide production latency. Filtered catalog loading is a separate scaling milestone.
