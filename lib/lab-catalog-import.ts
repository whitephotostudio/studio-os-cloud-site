import { parseCurrencyAmount, isSupportedCurrency } from "./labs/money";

export const CATALOG_IMPORT_MAX_BYTES = 2_000_000;
export const CATALOG_IMPORT_MAX_ROWS = 2000;
export const CATALOG_FIELDS = ["sku", "name", "category", "size", "width", "height", "finish", "cost", "currency", "popular"] as const;
export type CatalogField = typeof CATALOG_FIELDS[number];
export type CatalogMapping = Partial<Record<CatalogField, number>>;
export type CatalogImportRow = {
  sku: string; name: string; category: "prints" | "fine_art" | "canvas" | "metal";
  size: string; finish: string; costCents: number; currency: string;
  widthInches: number; heightInches: number; popular: boolean;
};
export type CatalogIssue = { row: number; field: string; message: string };
export type CatalogPreview = { headers: string[]; mapping: CatalogMapping; rows: CatalogImportRow[]; issues: CatalogIssue[]; sourceRowCount: number };

export class CatalogImportError extends Error {
  constructor(message: string) { super(message); }
}

/** RFC-4180 style CSV, including UTF-8 BOM, escaped quotes and embedded newlines. */
export function parseCatalogCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).length > CATALOG_IMPORT_MAX_BYTES) throw new CatalogImportError("Use a CSV smaller than 2 MB.");
  const input = text.replace(/^\uFEFF/, "");
  const firstLine = input.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes("\t") && !firstLine.includes(",") ? "\t"
    : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, afterQuote = false;
  function pushCell() { row.push(cell.trim()); cell = ""; afterQuote = false; }
  function pushRow() {
    pushCell();
    if (row.some(value => value !== "")) rows.push(row);
    row = [];
    if (rows.length > CATALOG_IMPORT_MAX_ROWS + 1) throw new CatalogImportError("Import up to 2,000 products at a time.");
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else cell += char;
    } else if (char === '"') {
      if (cell.trim() || afterQuote) throw new CatalogImportError("A quote is misplaced in the CSV. Export it again with quoted text fields.");
      quoted = true; cell = "";
    } else if (char === delimiter) pushCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      pushRow();
    } else if (afterQuote && char.trim()) throw new CatalogImportError("Unexpected text after a closing quote in the CSV.");
    else if (!afterQuote) cell += char;
    if (cell.length > 5000 || row.length > 50) throw new CatalogImportError("A catalog field or row is too long.");
  }
  if (quoted) throw new CatalogImportError("A quoted field is unfinished. Check the CSV export.");
  if (cell || row.length || afterQuote) pushRow();
  if (rows.length < 2) throw new CatalogImportError("Include a header row and at least one product.");
  if (rows[0].some(header => !header) || new Set(rows[0]).size !== rows[0].length) throw new CatalogImportError("Give every column a unique, nonempty heading.");
  return rows;
}

const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Record<CatalogField, string[]> = {
  sku: ["sku", "productcode", "labsku", "itemcode", "code"],
  name: ["name", "productname", "product", "itemname"],
  category: ["category", "productcategory", "type"],
  size: ["size", "printsize", "dimensions"],
  width: ["width", "widthinches", "widthin"], height: ["height", "heightinches", "heightin"],
  finish: ["finish", "paper", "surface", "papertype"],
  cost: ["wholesaleprice", "labcost", "cost", "price", "unitprice"],
  currency: ["currency", "currencycode"], popular: ["popular", "bestseller", "recommended"],
};
export function detectCatalogMapping(headers: string[]): CatalogMapping {
  return Object.fromEntries(CATALOG_FIELDS.flatMap(field => {
    const index = headers.findIndex(header => aliases[field].includes(normalized(header)));
    return index < 0 ? [] : [[field, index]];
  }));
}

function categoryFor(value: string): CatalogImportRow["category"] | null {
  const key = normalized(value);
  if (["prints", "print", "photographicprints", "photoprints"].includes(key)) return "prints";
  if (["fineart", "fineartprints", "fineartprint", "giclee"].includes(key)) return "fine_art";
  if (["canvas", "canvases", "canvaswrap", "canvaswraps"].includes(key)) return "canvas";
  if (["metal", "metals", "metalprints", "metalprint"].includes(key)) return "metal";
  return null;
}

/** Amounts in the file are major units, never floats silently rounded into a charge. */
export function catalogCostMinor(value: string, currency: string): number | null {
  if (!isSupportedCurrency(currency)) return null;
  let cleaned = value.trim().replace(new RegExp(`^${currency}\\s*`, "i"), "");
  const symbol = /^([$€£¥])\s*/.exec(cleaned);
  if (symbol) {
    const expected = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find(part => part.type === "currency")?.value;
    if (expected !== symbol[1]) return null;
    cleaned = cleaned.slice(symbol[0].length);
  }
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.replace(/,/g, "").split(".");
  const result = parseCurrencyAmount(`${whole}${fraction ? `.${fraction}` : ""}`, currency);
  return result !== null && result <= 100_000_000 ? result : null;
}

export function previewCatalogImport(text: string, mapping: CatalogMapping | undefined, labCurrency: string): CatalogPreview {
  const table = parseCatalogCsv(text), headers = table[0], chosen = mapping ?? detectCatalogMapping(headers);
  const issues: CatalogIssue[] = [], rows: CatalogImportRow[] = [];
  const add = (row: number, field: string, message: string) => issues.push({ row, field, message });
  for (const field of ["sku", "name", "category", "cost"] as const) {
    if (chosen[field] == null) add(1, field, `Choose the ${field === "cost" ? "wholesale price" : field} column.`);
  }
  if (chosen.size == null && (chosen.width == null || chosen.height == null)) add(1, "size", "Choose a size column or both width and height columns (in inches).");
  for (const [field, index] of Object.entries(chosen)) {
    if (!CATALOG_FIELDS.includes(field as CatalogField) || !Number.isInteger(index) || index! < 0 || index! >= headers.length) add(1, field, "Choose a column from this file.");
  }
  if (!isSupportedCurrency(labCurrency)) add(1, "currency", "Choose a supported ISO currency for this lab.");
  if (issues.length) return { headers, mapping: chosen, rows, issues, sourceRowCount: table.length - 1 };
  const seen = new Set<string>();
  table.slice(1).forEach((record, offset) => {
    const line = offset + 2, before = issues.length;
    const get = (field: CatalogField) => chosen[field] == null ? "" : (record[chosen[field]!] ?? "").trim();
    if (record.length !== headers.length) add(line, "row", "The number of cells does not match the header. Quote commas inside names and prices.");
    const sku = get("sku"), name = get("name"), finish = get("finish"), category = categoryFor(get("category"));
    const currency = (get("currency") || labCurrency).toUpperCase();
    if (!sku || sku.length > 100 || /[\x00-\x1f]/.test(sku)) add(line, "sku", "Use a product code of 1–100 characters without control characters.");
    if (seen.has(sku.toLowerCase())) add(line, "sku", "This product code appears more than once in the file.");
    seen.add(sku.toLowerCase());
    if (!name || name.length > 200 || /[\x00-\x1f]/.test(name)) add(line, "name", "Use a product name of 1–200 characters.");
    if (finish.length > 100 || /[\x00-\x1f]/.test(finish)) add(line, "finish", "Keep the finish name under 100 characters.");
    if (!category) add(line, "category", "Use Prints, Fine Art, Canvas or Metal.");
    if (currency !== labCurrency || !isSupportedCurrency(currency)) add(line, "currency", `This lab uses ${labCurrency}; currency conversion is not applied.`);
    const costCents = catalogCostMinor(get("cost"), currency);
    if (costCents == null) add(line, "cost", "Use a nonnegative price with the correct currency decimals, such as 2.40 for CAD or 240 for JPY.");
    const sizeText = get("size").replace(/["″]/g, "");
    const sizeMatch = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|inches)?$/i.exec(sizeText);
    const widthInches = Number(get("width") || sizeMatch?.[1]), heightInches = Number(get("height") || sizeMatch?.[2]);
    if (!(widthInches > 0 && widthInches <= 120 && heightInches > 0 && heightInches <= 120)) add(line, "size", "Use positive inch dimensions up to 120, such as 8x10. Convert metric sizes explicitly before importing.");
    const popular = get("popular").toLowerCase();
    if (popular && !["true", "false", "yes", "no", "1", "0"].includes(popular)) add(line, "popular", "Use yes/no or true/false for popular products.");
    if (before === issues.length) rows.push({ sku, name, category: category!, size: `${widthInches}x${heightInches}`, finish, costCents: costCents!, currency, widthInches, heightInches, popular: ["true", "yes", "1"].includes(popular) });
  });
  return { headers, mapping: chosen, rows, issues, sourceRowCount: table.length - 1 };
}

export const CATALOG_TEMPLATE = "sku,name,category,size,finish,wholesale_price,currency,popular\r\nYOUR-4X6-LUSTRE,4x6 Print,Prints,4x6,Lustre,2.40,CAD,yes\r\n";
