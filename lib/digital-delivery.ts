import { createHmac, timingSafeEqual } from "node:crypto";
import {
  buildArchiveBaseName,
} from "@/lib/event-gallery-downloads";
import {
  buildSchoolCandidateFolders,
  loadFolderMediaRows,
} from "@/lib/storage-folder";
import {
  r2KeyFromAnyUrl,
  r2PresignedGetUrl,
} from "@/lib/r2-signed-urls";
import { resendConfigured, resolveReplyTo, sendResendEmail } from "@/lib/resend";
import { cartSnapshotToOrderItems } from "@/lib/order-display";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip";
import {
  backdropCompositeFileName,
  composeBackdropImage,
  hasBackdropCompositeSelection,
  type BackdropCompositeSelection,
} from "@/lib/backdrop-composites";

type ServiceClient = {
  from: (table: string) => any;
};

type OrderRow = {
  id: string;
  photographer_id: string | null;
  status: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  parent_email?: string | null;
  customer_email?: string | null;
  parent_name?: string | null;
  customer_name?: string | null;
  package_name?: string | null;
  notes?: string | null;
  cart_snapshot?: unknown;
  school_id?: string | null;
  project_id?: string | null;
  student_id?: string | null;
};

type OrderItemRow = {
  id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  sku?: string | null;
};

type DeliveryOrderItemRow = OrderItemRow & {
  backdrop?: BackdropCompositeSelection | null;
  orientation?: "portrait" | "landscape";
};

type PhotographerRow = {
  id: string;
  business_name?: string | null;
  studio_email?: string | null;
  billing_email?: string | null;
};

type StudentRow = {
  id: string;
  school_id: string;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  folder_name?: string | null;
  pin?: string | null;
};

type SchoolRow = {
  id: string;
  school_name?: string | null;
  local_school_id?: string | null;
  photographer_id?: string | null;
};

type ProjectRow = {
  id: string;
  title?: string | null;
  name?: string | null;
  project_name?: string | null;
};

type MediaRow = {
  id: string;
  storage_path?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  filename?: string | null;
};

export type DigitalDeliveryFile = {
  key?: string;
  fileName: string;
  composite?: {
    originalUrlOrKey: string;
    backdrop: BackdropCompositeSelection;
    orientation?: "portrait" | "landscape";
  };
};

export type DigitalDeliveryContext = {
  order: OrderRow;
  photographer: PhotographerRow | null;
  recipientEmail: string;
  recipientName: string;
  studentName: string;
  galleryName: string;
  files: DigitalDeliveryFile[];
};

export type DigitalDeliveryTokenPayload = {
  v: 1;
  kind: "digital-order-delivery";
  orderId: string;
  recipientEmail: string;
  exp: number;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function lower(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function looksDigital(value: string | null | undefined) {
  const text = lower(value);
  if (text.includes("retouch")) return false;
  return (
    text.includes("digital") ||
    text.includes("download") ||
    text.includes("file") ||
    text.includes("jpg") ||
    text.includes("jpeg") ||
    text.includes("png") ||
    text.includes("usb")
  );
}

function looksAllDigital(...values: Array<string | null | undefined>) {
  const haystack = values.map(lower).filter(Boolean).join(" ");
  if (!looksDigital(haystack)) return false;
  return (
    /(all|full|entire|complete)\s+(digital|digitals|downloads|files|gallery|album|collection|photos|images)/.test(haystack) ||
    /(digital|digitals|downloads|files)\s+(all|full|entire|complete)/.test(haystack) ||
    haystack.includes("all photos") ||
    haystack.includes("all images") ||
    haystack.includes("all files")
  );
}

function normalizeKey(value: string | null | undefined) {
  const key = (r2KeyFromAnyUrl(value) || clean(value))
    .replace(/^\/+/, "")
    .split("?")[0]
    .split("#")[0];
  if (!key || key.includes("..")) return "";
  return key.replace(/_(preview|thumbnail)\.[^.]+$/i, ".jpg");
}

function isImageKey(key: string) {
  return /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(clean(key));
}

function fileNameFromKey(key: string) {
  const name = clean(key).split("/").pop() ?? "";
  return name || "photo.jpg";
}

function uniqueFiles(files: DigitalDeliveryFile[]) {
  const seen = new Set<string>();
  const out: DigitalDeliveryFile[] = [];
  for (const file of files) {
    const key = normalizeKey(file.key || file.composite?.originalUrlOrKey);
    if (!key || !isImageKey(key)) continue;
    const fingerprint = file.composite
      ? `composite:${key}:${clean(file.composite.backdrop.id)}:${clean(file.composite.backdrop.image_url) || clean(file.composite.backdrop.imageUrl)}:${file.composite.orientation ?? "portrait"}`
      : `file:${key}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({
      key,
      fileName: clean(file.fileName) || fileNameFromKey(key),
      composite: file.composite
        ? {
            ...file.composite,
            originalUrlOrKey: key,
          }
        : undefined,
    });
  }
  return out;
}

function uniqueDownloadName(name: string, usedNames: Map<string, number>) {
  const cleaned = clean(name).replace(/[\\/:*?"<>|\r\n]+/g, " ") || "photo.jpg";
  const lastDot = cleaned.lastIndexOf(".");
  const base = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const ext = lastDot > 0 ? cleaned.slice(lastDot) : "";
  const nextCount = (usedNames.get(cleaned) ?? 0) + 1;
  usedNames.set(cleaned, nextCount);
  return nextCount === 1 ? cleaned : `${base}-${nextCount}${ext}`;
}

function siteBaseUrl() {
  const configured =
    clean(process.env.NEXT_PUBLIC_SITE_URL) ||
    clean(process.env.NEXT_PUBLIC_APP_URL) ||
    clean(process.env.SITE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = clean(process.env.VERCEL_URL);
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  }
  return "https://www.studiooscloud.com";
}

function signingSecret() {
  const secret =
    clean(process.env.DIGITAL_DELIVERY_TOKEN_SECRET) ||
    clean(process.env.DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.EVENT_DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!secret) throw new Error("Missing digital delivery signing secret.");
  return secret;
}

function encodePayload(payload: DigitalDeliveryTokenPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as DigitalDeliveryTokenPayload;
}

function signEncodedPayload(value: string) {
  return createHmac("sha256", signingSecret()).update(value).digest("hex");
}

export function createDigitalDeliveryToken(payload: DigitalDeliveryTokenPayload) {
  const encoded = encodePayload(payload);
  return `${encoded}.${signEncodedPayload(encoded)}`;
}

export function verifyDigitalDeliveryToken(token: string) {
  const [encoded, signature] = clean(token).split(".");
  if (!encoded || !signature) throw new Error("Invalid digital delivery link.");
  const expected = signEncodedPayload(encoded);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid digital delivery link.");
  }
  const payload = decodePayload(encoded);
  if (payload.v !== 1 || payload.kind !== "digital-order-delivery") {
    throw new Error("Unsupported digital delivery link.");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
    throw new Error("This digital delivery link has expired.");
  }
  return payload;
}

function tokenDownloadUrl(payload: DigitalDeliveryTokenPayload) {
  const token = createDigitalDeliveryToken(payload);
  return `${siteBaseUrl()}/api/portal/digital-delivery?token=${encodeURIComponent(token)}`;
}

export function createDigitalDeliveryDownloadUrl(
  orderId: string,
  recipientEmail: string,
  options?: { expiresInDays?: number },
) {
  const days = Math.max(1, Math.min(90, options?.expiresInDays ?? 30));
  return tokenDownloadUrl({
    v: 1,
    kind: "digital-order-delivery",
    orderId,
    recipientEmail: recipientEmail.toLowerCase(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * days,
  });
}

function isPaidEnough(order: OrderRow) {
  const status = lower(order.status);
  const paymentStatus = lower(order.payment_status);
  if (order.paid_at) return true;
  if (paymentStatus === "paid" || paymentStatus === "succeeded") return true;
  return [
    "paid",
    "digital_paid",
    "digital_sent",
    "reviewed",
    "sent_to_print",
    "completed",
  ].includes(status);
}

async function fetchProjectMediaRows(service: ServiceClient, projectId: string) {
  const rows: MediaRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const { data, error } = await service
      .from("media")
      .select("id,storage_path,preview_url,thumbnail_url,filename,sort_order,created_at")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as MediaRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchOrderContext(service: ServiceClient, orderId: string) {
  const { data: order, error: orderError } = await service
    .from("orders")
    .select("id,photographer_id,status,payment_status,paid_at,parent_email,customer_email,parent_name,customer_name,package_name,notes,cart_snapshot,school_id,project_id,student_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order?.id) throw new Error("Order not found.");

  const { data: items, error: itemError } = await service
    .from("order_items")
    .select("id,product_name,quantity,sku")
    .eq("order_id", orderId);
  if (itemError) throw itemError;

  const [photographerResult, studentResult, schoolResult, projectResult] = await Promise.all([
    order.photographer_id
      ? service
          .from("photographers")
          .select("id,business_name,studio_email,billing_email")
          .eq("id", order.photographer_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    order.student_id
      ? service
          .from("students")
          .select("id,school_id,first_name,last_name,photo_url,class_id,class_name,folder_name,pin")
          .eq("id", order.student_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    order.school_id
      ? service
          .from("schools")
          .select("id,school_name,local_school_id,photographer_id")
          .eq("id", order.school_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    order.project_id
      ? service
          .from("projects")
          .select("id,title,name,project_name")
          .eq("id", order.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (photographerResult.error) throw photographerResult.error;
  if (studentResult.error) throw studentResult.error;
  if (schoolResult.error) throw schoolResult.error;
  if (projectResult.error) throw projectResult.error;

  return {
    order: order as OrderRow,
    items: (items ?? []) as OrderItemRow[],
    photographer: photographerResult.data as PhotographerRow | null,
    student: studentResult.data as StudentRow | null,
    school: schoolResult.data as SchoolRow | null,
    project: projectResult.data as ProjectRow | null,
  };
}

async function resolveDeliveryFiles(params: {
  service: ServiceClient;
  order: OrderRow;
  items: OrderItemRow[];
  student: StudentRow | null;
  school: SchoolRow | null;
  project: ProjectRow | null;
}) {
  const files: DigitalDeliveryFile[] = [];
  const snapshotItems: DeliveryOrderItemRow[] = cartSnapshotToOrderItems(params.order.cart_snapshot).map((item) => ({
    product_name: item.product_name,
    quantity: item.quantity,
    sku: item.sku,
    backdrop: item.backdrop ?? null,
    orientation: item.orientation ?? "portrait",
  }));
  const sourceItems: DeliveryOrderItemRow[] = snapshotItems.length
    ? snapshotItems
    : params.items;
  const snapshotBackdrop =
    snapshotItems.find((item) => item.backdrop)?.backdrop ?? null;
  const allDigitalBackdrop = await resolveBackdropForDelivery(
    params.service,
    params.order.photographer_id,
    snapshotBackdrop,
  );
  const orderPackageLooksDigital = looksDigital(params.order.package_name);
  const digitalItems = sourceItems.filter((item) =>
    looksDigital(item.product_name) ||
    (orderPackageLooksDigital && !!normalizeKey(item.sku)),
  );

  const fallbackDigitalOrder = !digitalItems.length && orderPackageLooksDigital
    ? [{ product_name: params.order.package_name, sku: null } as OrderItemRow]
    : [];
  const deliveryItems = digitalItems.length ? digitalItems : fallbackDigitalOrder;
  const wantsAll =
    deliveryItems.some((item) => looksAllDigital(item.product_name, params.order.package_name)) ||
    looksAllDigital(params.order.package_name);

  if (!deliveryItems.length) return [];

  if (wantsAll && params.order.school_id && params.student && params.school) {
    const rows = await loadFolderMediaRows(
      buildSchoolCandidateFolders({
        studentCandidates: [params.student],
        activeSchool: params.school,
        selectedSchoolId: params.order.school_id,
      }),
    );
    for (const row of rows) {
      const key = row.storage_path;
      files.push({
        key,
        fileName: allDigitalBackdrop
          ? backdropCompositeFileName(row.filename || fileNameFromKey(key), allDigitalBackdrop)
          : row.filename || fileNameFromKey(key),
        composite: allDigitalBackdrop
          ? {
              originalUrlOrKey: key,
              backdrop: allDigitalBackdrop,
              orientation: "portrait",
            }
          : undefined,
      });
    }
  } else if (wantsAll && params.order.project_id) {
    const rows = await fetchProjectMediaRows(params.service, params.order.project_id);
    for (const row of rows) {
      const key = normalizeKey(row.storage_path || row.preview_url || row.thumbnail_url);
      if (!key) continue;
      files.push({
        key,
        fileName: allDigitalBackdrop
          ? backdropCompositeFileName(clean(row.filename) || fileNameFromKey(key), allDigitalBackdrop)
          : clean(row.filename) || fileNameFromKey(key),
        composite: allDigitalBackdrop
          ? {
              originalUrlOrKey: key,
              backdrop: allDigitalBackdrop,
              orientation: "portrait",
            }
          : undefined,
      });
    }
  }

  for (const item of deliveryItems) {
    if (looksAllDigital(item.product_name, params.order.package_name)) continue;
    const key = normalizeKey(item.sku);
    if (!key) continue;
    const backdrop = await resolveBackdropForDelivery(
      params.service,
      params.order.photographer_id,
      (item as { backdrop?: BackdropCompositeSelection | null }).backdrop,
    );
    files.push({
      key,
      fileName: backdrop
        ? backdropCompositeFileName(fileNameFromKey(key), backdrop)
        : fileNameFromKey(key),
      composite: backdrop
        ? {
            originalUrlOrKey: key,
            backdrop,
            orientation: (item as { orientation?: "portrait" | "landscape" }).orientation ?? "portrait",
          }
        : undefined,
    });
  }

  return uniqueFiles(files);
}

async function resolveBackdropForDelivery(
  service: ServiceClient,
  photographerId: string | null | undefined,
  backdrop: BackdropCompositeSelection | null | undefined,
) {
  if (!backdrop) return null;
  if (hasBackdropCompositeSelection(backdrop)) return backdrop;
  const id = clean(backdrop.id);
  const studioId = clean(photographerId);
  if (!id || !studioId) return backdrop;
  const { data, error } = await service
    .from("backdrop_catalog")
    .select("id,name,image_url,tier,price_cents")
    .eq("photographer_id", studioId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return backdrop;
  return {
    ...backdrop,
    id: clean((data as Record<string, unknown>).id as string),
    name: clean((data as Record<string, unknown>).name as string),
    image_url: clean((data as Record<string, unknown>).image_url as string),
    tier: clean((data as Record<string, unknown>).tier as string),
    price_cents: Number((data as Record<string, unknown>).price_cents ?? 0) || 0,
  };
}

export async function resolveDigitalDeliveryContext(
  service: ServiceClient,
  orderId: string,
  options?: { recipientEmail?: string | null; requirePaid?: boolean },
): Promise<DigitalDeliveryContext> {
  const { order, items, photographer, student, school, project } =
    await fetchOrderContext(service, orderId);

  if (options?.requirePaid !== false && !isPaidEnough(order)) {
    throw new Error("This order is not paid yet.");
  }

  const recipientEmail =
    clean(options?.recipientEmail) ||
    clean(order.customer_email) ||
    clean(order.parent_email);
  if (!recipientEmail) throw new Error("No recipient email found for this order.");

  const files = await resolveDeliveryFiles({
    service,
    order,
    items,
    student,
    school,
    project,
  });
  if (!files.length) {
    throw new Error("No online high-resolution files were found for this digital order.");
  }

  const studentName = [
    clean(student?.first_name),
    clean(student?.last_name),
  ].filter(Boolean).join(" ");
  const galleryName =
    clean(school?.school_name) ||
    clean(project?.title) ||
    clean(project?.project_name) ||
    clean(project?.name) ||
    "your gallery";

  return {
    order,
    photographer,
    recipientEmail,
    recipientName: clean(order.customer_name) || clean(order.parent_name) || "there",
    studentName: studentName || "your photos",
    galleryName,
    files,
  };
}

export function digitalDeliveryFileName(context: DigitalDeliveryContext) {
  const base = buildArchiveBaseName(
    [context.galleryName, context.studentName].filter(Boolean).join(" - "),
    "digital-photos",
  );
  return `${base}.zip`;
}

export function contentDispositionAttachment(fileName: string) {
  const cleaned = buildArchiveBaseName(fileName, "digital-photos.zip");
  const zipName = cleaned.toLowerCase().endsWith(".zip") ? cleaned : `${cleaned}.zip`;
  const fallback = zipName
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const encoded = encodeURIComponent(zipName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function fetchR2Stream(key: string) {
  const url = r2PresignedGetUrl(key, 60 * 60);
  if (!url) throw new Error(`Could not sign ${key}.`);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Could not load ${key}: HTTP ${response.status}`);
  }
  return response.body;
}

function uint8ArrayToReadableStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function* buildDigitalDeliveryZipEntries(
  files: DigitalDeliveryFile[],
): AsyncGenerator<ZipStreamEntry> {
  const usedNames = new Map<string, number>();
  const skipped: string[] = [];

  for (const file of files) {
    try {
      const composite = file.composite
        ? await composeBackdropImage({
            originalUrlOrKey: file.composite.originalUrlOrKey,
            backdrop: file.composite.backdrop,
            orientation: file.composite.orientation,
          })
        : null;
      const stream = composite
        ? uint8ArrayToReadableStream(composite.buffer)
        : await fetchR2Stream(file.key ?? "");
      yield {
        name: uniqueDownloadName(file.fileName, usedNames),
        stream,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[digital-delivery] skipping ${file.key || file.fileName}: ${message}`);
      skipped.push(file.fileName || file.key || "photo");
    }
  }

  if (skipped.length) {
    yield {
      name: uniqueDownloadName("Skipped Files.txt", usedNames),
      data: new TextEncoder().encode([
        "The following files could not be included in this ZIP:",
        "",
        ...skipped.map((name) => `- ${name}`),
      ].join("\n")),
    };
  }
}

function escHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendDigitalDeliveryEmailForOrder(
  service: ServiceClient,
  orderId: string,
  options?: { recipientEmail?: string | null; force?: boolean },
) {
  if (!resendConfigured()) {
    return {
      ok: false as const,
      skipped: true as const,
      reason: "email_not_configured",
      message: "Email delivery is not configured on the server.",
    };
  }

  const context = await resolveDigitalDeliveryContext(service, orderId, {
    recipientEmail: options?.recipientEmail,
    requirePaid: true,
  });

  const notes = clean(context.order.notes);
  if (!options?.force && notes.includes("Digital delivery link emailed")) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "already_sent",
      fileCount: context.files.length,
    };
  }

  const tokenPayload: DigitalDeliveryTokenPayload = {
    v: 1,
    kind: "digital-order-delivery",
    orderId,
    recipientEmail: context.recipientEmail.toLowerCase(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
  };
  const downloadUrl = tokenDownloadUrl(tokenPayload);
  const businessName = clean(context.photographer?.business_name) || "Studio OS";
  const replyTo =
    resolveReplyTo(context.photographer?.studio_email) ||
    resolveReplyTo(context.photographer?.billing_email);
  const plural = context.files.length === 1 ? "photo" : "photos";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:620px;margin:32px auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#111827;color:#ffffff;padding:26px 32px;">
      <div style="font-size:22px;font-weight:900;">${escHtml(businessName)}</div>
      <div style="font-size:13px;color:#d1d5db;margin-top:4px;">Digital photo delivery</div>
    </div>
    <div style="padding:30px 32px;">
      <h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;">Your digital images are ready</h1>
      <p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0 0 18px;">
        Hi ${escHtml(context.recipientName)}, your ZIP file for ${escHtml(context.studentName)} from ${escHtml(context.galleryName)} is ready to download.
      </p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:0 0 24px;color:#374151;font-size:14px;">
        Included: <strong>${context.files.length}</strong> ${plural}
      </div>
      <a href="${escHtml(downloadUrl)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:800;border-radius:999px;padding:13px 22px;">
        Download ZIP
      </a>
      <p style="font-size:12px;line-height:1.5;color:#6b7280;margin:24px 0 0;">
        This secure link expires in 30 days. If you need help, reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = [
    `Hi ${context.recipientName},`,
    "",
    `Your ZIP file for ${context.studentName} from ${context.galleryName} is ready.`,
    `Included: ${context.files.length} ${plural}.`,
    "",
    `Download: ${downloadUrl}`,
    "",
    "This secure link expires in 30 days. If you need help, reply to this email.",
  ].join("\n");

  await sendResendEmail({
    to: context.recipientEmail,
    subject: "Your digital photos are ready",
    html,
    text,
    fromName: businessName,
    replyTo,
    tags: [
      { name: "type", value: "digital-delivery" },
      { name: "order_id", value: orderId },
    ],
    idempotencyKey: `digital-delivery-${orderId}-${context.recipientEmail.toLowerCase()}`,
  });

  const noteLine = `Digital delivery link emailed ${new Date().toISOString()} (${context.files.length} ${plural}) to ${context.recipientEmail}.`;
  await service
    .from("orders")
    .update({
      notes: notes ? `${notes}\n\n${noteLine}` : noteLine,
    })
    .eq("id", orderId);

  return {
    ok: true as const,
    skipped: false as const,
    fileCount: context.files.length,
    recipientEmail: context.recipientEmail,
  };
}

export function createDigitalDeliveryZipStream(context: DigitalDeliveryContext) {
  return createZipStream(buildDigitalDeliveryZipEntries(context.files));
}
