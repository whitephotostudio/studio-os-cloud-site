import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import {
  customerInvoiceDetail,
  customerInvoicePdfFallback,
  customerInvoiceSearchFilter,
  customerInvoiceSummary,
} from "@/lib/customer-invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["draft", "issued", "sent", "paid", "void"]);
const INVOICE_LIST_FIELDS = "id,client_request_id,document_number,status,client_name,client_email,project_reference,currency_code,issue_date,due_date,updated_at,total_cents,outstanding_cents";
const INVOICE_DETAIL_FIELDS = `${INVOICE_LIST_FIELDS},client_address,tax_label,subtotal_cents,tax_cents,document_json`;

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function pageNumber(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback;
  if (!/^\d{1,6}$/.test(value)) return null;
  const number = Number(value);
  return number <= maximum ? number : null;
}

async function invoicePdfUrl(
  service: ReturnType<typeof createDashboardServiceClient>,
  userId: string,
  clientRequestId: string,
  status: string,
): Promise<string | null> {
  // The desktop app uploads into a private bucket under the auth user's id.
  // Never sign a path built from an unchecked request or a different owner.
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(clientRequestId)) return null;
  try {
    const prefix = `${userId}/invoice/${clientRequestId}`;
    const storage = service.storage.from("sales-document-assets");
    const { data: files, error: listError } = await storage.list(prefix, { limit: 100 });
    if (listError || !files?.length) return null;
    const found = customerInvoicePdfFallback(status)
      .map((name) => `${name}.pdf`)
      .find((name) => files.some((file) => file.name === name));
    if (!found) return null;
    const { data, error } = await storage.createSignedUrl(`${prefix}/${found}`, 300);
    return error ? null : data?.signedUrl ?? null;
  } catch {
    // Invoice details remain readable if asset sync or storage is unavailable.
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, mfaSatisfied } = await resolveDashboardAuth(request);
    if (!user || !mfaSatisfied) {
      return privateJson({ ok: false, message: "Please sign in again." }, 401);
    }

    const service = createDashboardServiceClient();
    const { data: photographer, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (photographerError) throw photographerError;
    if (!photographer?.id) {
      return privateJson({ ok: false, message: "Photographer profile not found." }, 404);
    }

    const params = request.nextUrl.searchParams;
    const id = params.get("id");
    if (id !== null) {
      if (!UUID.test(id)) return privateJson({ ok: false, message: "Invalid invoice." }, 400);
      const { data: row, error } = await service
        .from("sales_documents")
        .select(INVOICE_DETAIL_FIELDS)
        .eq("photographer_id", photographer.id)
        .eq("kind", "invoice")
        .is("deleted_at", null)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!row) return privateJson({ ok: false, message: "Invoice not found." }, 404);
      const pdfUrl = await invoicePdfUrl(
        service,
        user.id,
        String(row.client_request_id ?? ""),
        String(row.status ?? ""),
      );
      return privateJson({ ok: true, invoice: customerInvoiceDetail(row, pdfUrl) });
    }

    const offset = pageNumber(params.get("offset"), 0, 100000);
    const limit = pageNumber(params.get("limit"), 50, 100);
    const search = (params.get("search") ?? "").trim();
    const status = params.get("status") ?? "all";
    if (offset === null || limit === null || limit < 1 || search.length > 80 ||
        (status !== "all" && !STATUSES.has(status))) {
      return privateJson({ ok: false, message: "Invalid invoice filters." }, 400);
    }

    let query = service
      .from("sales_documents")
      .select(INVOICE_LIST_FIELDS, { count: "exact" })
      .eq("photographer_id", photographer.id)
      .eq("kind", "invoice")
      .is("deleted_at", null);
    if (status !== "all") query = query.eq("status", status);
    const filter = customerInvoiceSearchFilter(search);
    if (filter) query = query.or(filter);
    const { data, count, error } = await query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return privateJson({
      ok: true,
      invoices: (data ?? []).map(customerInvoiceSummary),
      count: count ?? 0,
      offset,
      limit,
    });
  } catch (error) {
    console.error("[dashboard:sales-documents:GET]", error);
    return privateJson({ ok: false, message: "Could not load customer invoices." }, 500);
  }
}
