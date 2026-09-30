import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "sales-document-assets";
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const INVOICE_STATUS = new Set(["draft", "issued", "sent", "paid", "void"]);
const QUOTE_STATUS = new Set([
  "draft", "finalized", "sent", "accepted", "declined", "expired", "converted",
]);
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function currentStatus(value: unknown): string {
  const status = String(value ?? "").trim().toLowerCase();
  return status === "voided" ? "void" : status;
}

export async function POST(request: NextRequest) {
  try {
    const { user, mfaSatisfied } = await resolveDashboardAuth(request);
    if (!user || !mfaSatisfied) {
      return privateJson({ ok: false, message: "Please sign in again." }, 401);
    }

    const body = await request.json().catch(() => null);
    const kind = body?.kind;
    const documentId = body?.documentId;
    const asset = body?.asset;
    const status = currentStatus(body?.status);
    const contentType = body?.contentType;
    const byteLength = body?.byteLength;
    if (
      (kind !== "invoice" && kind !== "quote") ||
      typeof documentId !== "string" || !SAFE_ID.test(documentId) ||
      (asset !== "pdf" && asset !== "logo") ||
      !Number.isSafeInteger(byteLength) || byteLength < 1 ||
      (asset === "pdf" && (
        contentType !== "application/pdf" ||
        byteLength > 100 * 1024 * 1024 ||
        !(kind === "invoice" ? INVOICE_STATUS : QUOTE_STATUS).has(status)
      )) ||
      (asset === "logo" && (
        !LOGO_TYPES.has(contentType) || byteLength > 5 * 1024 * 1024
      ))
    ) {
      return privateJson({ ok: false, message: "Invalid sales asset." }, 400);
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
    const quota = await rateLimit(photographer.id, {
      namespace: "sales-asset-sign-upload",
      limit: 300,
      windowSeconds: 60,
    });
    if (!quota.allowed) {
      return privateJson({ ok: false, message: "Too many asset requests. Retry shortly." }, 429);
    }

    const { data: document, error: documentError } = await service
      .from("sales_documents")
      .select("id,status")
      .eq("photographer_id", photographer.id)
      .eq("kind", kind)
      .eq("client_request_id", documentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document) {
      return privateJson({ ok: false, message: "Sales document not found." }, 404);
    }
    if (asset === "pdf" && currentStatus(document.status) !== status) {
      return privateJson({ ok: false, message: "Sync the latest document status first." }, 409);
    }

    const key = `${user.id}/${kind}/${documentId}/${asset === "logo" ? "logo" : `${status}.pdf`}`;
    const { data, error } = await service.storage
      .from(BUCKET)
      .createSignedUploadUrl(key, { upsert: true });
    if (error || !data?.token) {
      console.error("[dashboard:sales-assets:sign-upload] Storage unavailable", error);
      return privateJson({ ok: false, message: "Sales asset storage is not ready. Retry later." }, 503);
    }
    return privateJson({ ok: true, bucket: BUCKET, key, token: data.token });
  } catch (error) {
    console.error("[dashboard:sales-assets:sign-upload]", error);
    return privateJson({ ok: false, message: "Could not prepare sales asset upload." }, 500);
  }
}
