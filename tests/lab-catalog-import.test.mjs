import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (context.parentURL?.includes("/lib/") && specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
  return nextResolve(specifier, context);
} });
const { parseCatalogCsv, detectCatalogMapping, previewCatalogImport, catalogCostMinor, CATALOG_TEMPLATE } = await import("../lib/lab-catalog-import.ts");
const { labCheckoutIssue } = await import("../lib/lab-checkout-policy.ts");
const { isLabCountryCode, labCountryOptions } = await import("../lib/lab-directory.ts");

test("CSV handles quoted delimiters, escaped quotes, CRLF, BOM and tab exports", () => {
  assert.deepEqual(parseCatalogCsv('\uFEFFsku,name\r\nONE,"Print, \"\"Pearl\"\""\r\n'), [["sku", "name"], ["ONE", 'Print, "Pearl"']]);
  assert.deepEqual(parseCatalogCsv("sku\tname\nONE\tPrint"), [["sku", "name"], ["ONE", "Print"]]);
  assert.deepEqual(parseCatalogCsv("sku;name\nONE;Print"), [["sku", "name"], ["ONE", "Print"]]);
  assert.throws(() => parseCatalogCsv('sku,name\nONE,"unfinished'), /unfinished/);
  assert.throws(() => parseCatalogCsv('sku,name\nONE,"Name"injected'), /Unexpected/);
  assert.throws(() => parseCatalogCsv("sku,sku\nONE,Print"), /unique/);
  assert.throws(() => parseCatalogCsv("name\n" + "x".repeat(2_000_001)), /2 MB/);
});

test("catalog template gives reviewable major-unit prices; invalid rows do not disappear", () => {
  const result = previewCatalogImport(CATALOG_TEMPLATE, undefined, "CAD");
  assert.equal(result.rows.length, 1); assert.deepEqual(result.issues, []);
  assert.equal(result.rows[0].costCents, 240); assert.equal(result.rows[0].widthInches, 4);
  const csv = CATALOG_TEMPLATE + "YOUR-4X6-LUSTRE,Other,Prints,4x6,Lustre,2.405,CAD,yes\n";
  const invalid = previewCatalogImport(csv, undefined, "CAD");
  assert.equal(invalid.sourceRowCount, 2); assert.ok(invalid.issues.some(x => x.field === "sku" && x.row === 3));
  assert.ok(invalid.issues.some(x => x.field === "cost" && x.row === 3));
  const foreign = previewCatalogImport(CATALOG_TEMPLATE, undefined, "USD");
  assert.ok(foreign.issues.some(x => x.field === "currency"));
  const malformed = previewCatalogImport(CATALOG_TEMPLATE.replace("Prints,4x6", "Unknown,0x10"), undefined, "CAD");
  assert.ok(malformed.issues.some(x => x.field === "category")); assert.ok(malformed.issues.some(x => x.field === "size"));
});

test("header mapping supports nonstandard lab columns and bounded explicit dimensions", () => {
  const csv = "Code,Description,Type,W,H,Paper,Unit price\nP1,Art print,Fine Art,8,10,Rag,19.55\n";
  const mapping = { sku: 0, name: 1, category: 2, width: 3, height: 4, finish: 5, cost: 6 };
  const result = previewCatalogImport(csv, mapping, "CAD");
  assert.deepEqual(result.issues, []); assert.equal(result.rows[0].category, "fine_art");
  assert.equal(result.rows[0].costCents, 1955);
  assert.ok(previewCatalogImport(csv, { ...mapping, cost: 99 }, "CAD").issues.length);
  assert.equal(detectCatalogMapping(["Product Code", "Wholesale Price"]).cost, 1);
  assert.throws(() => parseCatalogCsv("sku,name\n" + Array.from({length: 2001}, (_, i) => `${i},Print`).join("\n")), /2,000/);
});

test("physical print pieces per priced unit are explicit optional integers, never guessed from names or blank cells", () => {
  const header = "sku,name,category,size,finish,wholesale_price,currency,popular,prints_per_unit\n";
  const row = count => `PAIR,Pair of 5x7 Prints,Prints,5x7,Lustre,4.00,CAD,no,${count}\n`;
  assert.equal(detectCatalogMapping(header.trim().split(',')).printsPerUnit, 8);
  for (const count of ['1', '2', '10', '100']) {
    const result = previewCatalogImport(header + row(count), undefined, 'CAD');
    assert.deepEqual(result.issues, []);
    assert.equal(result.rows[0].printsPerUnit, Number(count));
  }
  assert.equal(previewCatalogImport(header + row(''), undefined, 'CAD').rows[0].printsPerUnit, null);
  const oldFile = 'sku,name,category,size,finish,wholesale_price\nPAIR,2 - 5x7 Prints,Prints,5x7,Lustre,4.00\n';
  assert.equal(previewCatalogImport(oldFile, undefined, 'CAD').rows[0].printsPerUnit, null);
  for (const count of ['0', '-1', '101', '1.5', '1.0', '01', '1e1', 'one']) {
    const result = previewCatalogImport(header + row(count), undefined, 'CAD');
    assert.equal(result.rows.length, 0);
    assert.ok(result.issues.some(issue => issue.field === 'printsPerUnit'));
  }
});

test("international prices stay in exact currency minor units without guessed FX", () => {
  assert.equal(catalogCostMinor("CAD 1,234.50", "CAD"), 123450);
  assert.equal(catalogCostMinor("0.29", "CAD"), 29);
  assert.equal(catalogCostMinor("€10.00", "CAD"), null);
  assert.equal(catalogCostMinor("$100", "JPY"), null);
  assert.equal(catalogCostMinor("240", "JPY"), 240);
  assert.equal(catalogCostMinor("240.10", "JPY"), null);
  assert.equal(catalogCostMinor("1.234", "BHD"), 1234);
  assert.equal(catalogCostMinor("1.2345", "BHD"), null);
  for (const value of ["-1", "NaN", "Infinity", "1e4", "2,40", "0.00001", "999999999999999"]) assert.equal(catalogCostMinor(value, "CAD"), null);
  assert.equal(catalogCostMinor("1", "ZZZ"), null);
  assert.equal(isLabCountryCode("CA"), true); assert.equal(isLabCountryCode("JP"), true); assert.equal(isLabCountryCode("XX"), false);
  assert.ok(labCountryOptions.length > 200);
});

test("new lab metadata cannot activate old checkout, including malformed markers", () => {
  assert.equal(labCheckoutIssue([{ items: [{ name: "8x10 Print", qty: 1 }] }]), null);
  for (const lab of [null, {}, { labId: "anything" }]) assert.match(labCheckoutIssue([{ items: [{ lab }] }]), /being prepared/);
});
