/** The customer invoices created in Studio OS Sales, not Stripe subscription bills. */
export type CustomerInvoiceSummary = {
  id: string;
  clientRequestId: string;
  number: string;
  status: string;
  clientName: string;
  clientEmail: string;
  projectReference: string;
  currencyCode: string;
  issueDate: string | null;
  dueDate: string | null;
  updatedAt: string | null;
  totalCents: number;
  outstandingCents: number;
};

export type CustomerInvoiceLine = {
  id: string;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  totalCents: number;
  taxable: boolean;
};

export type CustomerInvoiceDetail = CustomerInvoiceSummary & {
  clientAddress: string;
  studioName: string;
  studioEmail: string;
  studioPhone: string;
  studioAddress: string;
  notes: string;
  terms: string;
  taxLabel: string;
  subtotalCents: number;
  taxCents: number;
  lineItems: CustomerInvoiceLine[];
  pdfUrl: string | null;
};

type Row = Record<string, unknown>;

function str(value: unknown, max = 10000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function int(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function date(value: unknown): string | null {
  const text = str(value, 40);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function payload(row: Row): Row {
  const raw = row.document_json;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Row : {};
}

/** Only fields needed by the mobile invoice list leave the server. */
export function customerInvoiceSummary(row: Row): CustomerInvoiceSummary {
  const doc = payload(row);
  return {
    id: str(row.id, 100),
    clientRequestId: str(row.client_request_id, 200),
    number: str(row.document_number ?? doc.invoiceNumber, 100),
    status: str(row.status ?? doc.status, 30).toLowerCase(),
    clientName: str(row.client_name ?? doc.clientName, 300),
    clientEmail: str(row.client_email ?? doc.clientEmail, 300),
    projectReference: str(row.project_reference ?? doc.projectReference, 300),
    currencyCode: str(row.currency_code ?? doc.currencyCode, 10).toUpperCase() || "CAD",
    issueDate: date(row.issue_date ?? doc.issueDate),
    dueDate: date(row.due_date ?? doc.dueDate),
    updatedAt: date(row.updated_at ?? doc.updatedAt),
    totalCents: int(row.total_cents ?? doc.totalCents),
    outstandingCents: int(row.outstanding_cents ?? doc.outstandingCents),
  };
}

export function customerInvoiceDetail(row: Row, pdfUrl: string | null): CustomerInvoiceDetail {
  const doc = payload(row);
  const rawLines = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const lineItems = rawLines.slice(0, 500).flatMap((raw, index): CustomerInvoiceLine[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Row;
    const quantityMilli = item.quantityMilli == null ? 1000 : int(item.quantityMilli);
    const unitPriceCents = int(item.unitPriceCents);
    const amount = Math.abs(quantityMilli * unitPriceCents);
    const totalCents = Math.sign(quantityMilli * unitPriceCents) * Math.round(amount / 1000);
    return [{
      id: str(item.id, 100) || String(index),
      description: str(item.description, 2000),
      quantityMilli,
      unitPriceCents,
      totalCents,
      taxable: item.taxable !== false,
    }];
  });

  return {
    ...customerInvoiceSummary(row),
    clientAddress: str(row.client_address ?? doc.clientAddress, 2000),
    studioName: str(doc.studioName, 300),
    studioEmail: str(doc.studioEmail, 300),
    studioPhone: str(doc.studioPhone, 100),
    studioAddress: str(doc.studioAddress, 2000),
    notes: str(doc.notes),
    terms: str(doc.terms),
    taxLabel: str(row.tax_label ?? doc.taxLabel, 100) || "Tax",
    subtotalCents: int(row.subtotal_cents),
    taxCents: int(row.tax_cents),
    lineItems,
    pdfUrl,
  };
}

/** Keep PostgREST OR syntax out of user-entered search text. */
export function customerInvoiceSearchFilter(search: string): string | null {
  const safe = search.normalize("NFKC").replace(/[^\p{L}\p{N}@.'\- ]/gu, "").trim().slice(0, 80);
  if (!safe) return null;
  const pattern = `"%${safe}%"`;
  return `client_name.ilike.${pattern},client_email.ilike.${pattern},document_number.ilike.${pattern},project_reference.ilike.${pattern}`;
}

export function customerInvoiceMoney(cents: number, currencyCode: string): string {
  const code = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : "CAD";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: code }).format(cents / 100);
}

/** An upload may still be catching up with a status transition. */
export function customerInvoicePdfFallback(status: string): string[] {
  switch (status) {
    case "draft": return ["draft"];
    case "issued": return ["issued"];
    case "sent": return ["sent", "issued"];
    case "paid": return ["paid", "sent", "issued"];
    case "void": return ["void", "paid", "sent", "issued"];
    default: return [];
  }
}
