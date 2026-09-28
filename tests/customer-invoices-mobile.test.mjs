import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  customerInvoiceDetail,
  customerInvoicePdfFallback,
  customerInvoiceSearchFilter,
  customerInvoiceSummary,
} from "../lib/customer-invoices.ts";

test("mobile invoice summary uses authoritative cloud columns without local paths or logo data", () => {
  const row = {
    id: "invoice-uuid",
    client_request_id: "invoice_local",
    document_number: "INV-0042",
    status: "paid",
    client_name: "Cloud client",
    currency_code: "cad",
    total_cents: 12550,
    outstanding_cents: 0,
    document_json: {
      clientName: "Stale local client",
      pdfPath: "/Users/Someone/private.pdf",
      studioLogoBase64: "private-logo-data",
    },
  };
  const summary = customerInvoiceSummary(row);
  assert.equal(summary.clientName, "Cloud client");
  assert.equal(summary.number, "INV-0042");
  assert.equal(summary.totalCents, 12550);
  assert.equal(summary.currencyCode, "CAD");
  assert.equal(JSON.stringify(summary).includes("private.pdf"), false);
  assert.equal(JSON.stringify(summary).includes("private-logo-data"), false);
});

test("mobile invoice detail keeps financial fields and line items but omits machine-only paths", () => {
  const detail = customerInvoiceDetail({
    id: "invoice-uuid",
    status: "issued",
    subtotal_cents: 1433,
    tax_cents: 186,
    total_cents: 1619,
    document_json: {
      studioName: "Studio",
      notes: "Thank you",
      pdfPath: "/private/local-invoice.pdf",
      sourceDocumentPath: "/private/source.pdf",
      studioLogoBase64: "base64-logo",
      lineItems: [
        { id: "a", description: "Portrait", quantityMilli: 1500, unitPriceCents: 999 },
        { id: "b", description: "Discount", quantityMilli: 1000, unitPriceCents: -66 },
      ],
    },
  }, null);
  assert.equal(detail.lineItems[0].totalCents, 1499);
  assert.equal(detail.lineItems[1].totalCents, -66);
  assert.equal(detail.taxCents, 186);
  assert.equal(detail.pdfUrl, null);
  assert.equal(JSON.stringify(detail).includes("/private/"), false);
  assert.equal(JSON.stringify(detail).includes("base64-logo"), false);
});

test("invoice search filter strips PostgREST control characters", () => {
  const filter = customerInvoiceSearchFilter('Mary),status.eq.paid,"%');
  assert.ok(filter);
  const clauses = filter.split(",");
  assert.equal(clauses.length, 4);
  assert.deepEqual(clauses.map((clause) => clause.split(".ilike.")[0]), [
    "client_name", "client_email", "document_number", "project_reference",
  ]);
  assert.equal(filter.includes("),"), false);
  assert.equal(filter.includes('"%"'), false);
});

test("private PDF lookup follows the latest available invoice state", () => {
  assert.deepEqual(customerInvoicePdfFallback("void"), ["void", "paid", "sent", "issued"]);
  assert.deepEqual(customerInvoicePdfFallback("paid"), ["paid", "sent", "issued"]);
  assert.deepEqual(customerInvoicePdfFallback("draft"), ["draft"]);
});

test("customer invoice API is authenticated, owner-scoped, read-only and separate from Stripe billing", () => {
  const route = readFileSync(new URL("../app/api/dashboard/sales-documents/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolveDashboardAuth\(request\)/);
  assert.match(route, /\.eq\("user_id", user\.id\)/);
  assert.equal((route.match(/\.eq\("photographer_id", photographer\.id\)/g) ?? []).length, 2);
  assert.equal((route.match(/\.eq\("kind", "invoice"\)/g) ?? []).length, 2);
  assert.equal((route.match(/\.is\("deleted_at", null\)/g) ?? []).length, 2);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /stripeRequest|listRecentStripeInvoices/);
});
