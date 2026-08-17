import { createHash } from "node:crypto";

import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { resolveReplyTo, sendResendEmail } from "@/lib/resend";
import {
  createUploadedDeliveryToken,
  type UploadedDeliveryTokenPayload,
} from "@/lib/uploaded-digital-delivery-security";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function siteBaseUrl() {
  const configured =
    clean(process.env.NEXT_PUBLIC_SITE_URL) ||
    clean(process.env.NEXT_PUBLIC_APP_URL) ||
    clean(process.env.SITE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = clean(process.env.VERCEL_URL);
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  return "https://www.studiooscloud.com";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFileName(value: string, fallback: string) {
  const result = clean(value).replace(/[\\/:*?"<>|\r\n]+/g, " ").slice(0, 160);
  return result || fallback;
}

function baseNameFromKey(key: string) {
  return safeFileName(key.split("/").pop() ?? "", "photo.jpg");
}

function uniqueName(name: string, used: Map<string, number>) {
  const next = (used.get(name) ?? 0) + 1;
  used.set(name, next);
  if (next === 1) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-${next}${name.slice(dot)}` : `${name}-${next}`;
}

export function uploadedDeliveryDownloadUrl(payload: UploadedDeliveryTokenPayload) {
  const token = createUploadedDeliveryToken(payload);
  return `${siteBaseUrl()}/api/portal/uploaded-digital-delivery?token=${encodeURIComponent(token)}`;
}

export function uploadedDeliveryZipName(schoolName: string, studentName: string) {
  const base = safeFileName(
    [clean(schoolName), clean(studentName), "digital photos"].filter(Boolean).join(" - "),
    "digital photos",
  );
  return `${base}.zip`;
}

export function uploadedDeliveryContentDisposition(fileName: string) {
  const safe = safeFileName(fileName, "digital-photos.zip");
  const fallback = safe.replace(/[^\x20-\x7e]/g, "_").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function fetchObjectStream(key: string) {
  const url = r2PresignedGetUrl(key, 15 * 60);
  if (!url) throw new Error("Could not authorize a delivery file.");
  const response = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!response.ok || !response.body) throw new Error("Could not load a delivery file.");
  return response.body;
}

async function* uploadedDeliveryEntries(keys: string[]): AsyncGenerator<ZipStreamEntry> {
  const used = new Map<string, number>();
  let skipped = 0;
  for (const key of keys) {
    try {
      yield {
        name: uniqueName(baseNameFromKey(key), used),
        stream: await fetchObjectStream(key),
      };
    } catch (error) {
      skipped += 1;
      console.error("[uploaded-digital-delivery] file unavailable", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  if (skipped) {
    yield {
      name: uniqueName("Delivery Notice.txt", used),
      data: new TextEncoder().encode(
        `${skipped} photo${skipped === 1 ? " was" : "s were"} unavailable. Please contact the studio.`,
      ),
    };
  }
}

export function createUploadedDeliveryZipStream(keys: string[]) {
  return createZipStream(uploadedDeliveryEntries(keys));
}

export async function sendUploadedDeliveryEmail(input: {
  orderId: string;
  recipientEmail: string;
  recipientName: string;
  studentName: string;
  schoolName: string;
  businessName: string;
  replyTo?: string | null;
  objectKeys: string[];
}) {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const url = uploadedDeliveryDownloadUrl({
    v: 1,
    kind: "uploaded-digital-order-delivery",
    orderId: input.orderId,
    recipientEmail: input.recipientEmail.toLowerCase(),
    objectKeys: input.objectKeys,
    exp: expiresAt,
  });
  const businessName = clean(input.businessName) || "Studio OS";
  const recipientName = clean(input.recipientName) || "there";
  const studentName = clean(input.studentName) || "your photos";
  const schoolName = clean(input.schoolName) || "your gallery";
  const plural = input.objectKeys.length === 1 ? "photo" : "photos";
  const manifestHash = createHash("sha256").update(input.objectKeys.join("\n"), "utf8").digest("hex").slice(0, 20);

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:620px;margin:32px auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#111827;color:#ffffff;padding:26px 32px;">
      <div style="font-size:22px;font-weight:900;">${escapeHtml(businessName)}</div>
      <div style="font-size:13px;color:#d1d5db;margin-top:4px;">Digital photo delivery</div>
    </div>
    <div style="padding:30px 32px;">
      <h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;">Your digital images are ready</h1>
      <p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0 0 18px;">Hi ${escapeHtml(recipientName)}, your secure ZIP file for ${escapeHtml(studentName)} from ${escapeHtml(schoolName)} is ready.</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:0 0 24px;color:#374151;font-size:14px;">Included: <strong>${input.objectKeys.length}</strong> ${plural}</div>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:800;border-radius:999px;padding:13px 22px;">Download ZIP</a>
      <p style="font-size:12px;line-height:1.5;color:#6b7280;margin:24px 0 0;">This private link expires in 30 days. If you need help, reply to this email.</p>
    </div>
  </div>
</body></html>`;

  const text = [
    `Hi ${recipientName},`,
    "",
    `Your secure ZIP file for ${studentName} from ${schoolName} is ready.`,
    `Included: ${input.objectKeys.length} ${plural}.`,
    "",
    `Download: ${url}`,
    "",
    "This private link expires in 30 days. If you need help, reply to this email.",
  ].join("\n");

  await sendResendEmail({
    to: input.recipientEmail,
    subject: "Your digital photos are ready",
    html,
    text,
    fromName: businessName,
    replyTo: resolveReplyTo(input.replyTo),
    tags: [
      { name: "type", value: "uploaded-digital-delivery" },
      { name: "order_id", value: input.orderId },
    ],
    idempotencyKey: `uploaded-digital-${input.orderId}-${manifestHash}`,
  });

  return { expiresAt, fileCount: input.objectKeys.length };
}
