import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ProductionAuthError,
  productionAuth,
  currentProductionOrders,
  productionFinancialRevision,
} from "@/lib/order-automation-auth";
import {
  productionKey,
  readProductionJson,
  readProduction,
  writeProductionJson,
  writeProduction,
  digest,
} from "@/lib/order-automation-storage";
import { labEmailText } from "@/lib/order-automation-quality";
import { verifyNoritsuZip } from "@/lib/order-automation-zip";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/);
const schema = z
  .object({
    batchId: hash,
    zipSha256: hash,
    key: z.string().max(200),
    labEmail: z.email().max(254),
    labName: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^\x00-\x1f<>]+$/),
    turnaroundDays: z.number().int().min(1).max(30),
    orders: z
      .array(
        z
          .object({ localId: id, cloudId: z.string().uuid(), snapshot: hash })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
type Batch = {
  owner: string;
  fingerprint: string;
  zipKey: string;
  zipSha256: string;
  token: string;
  expiresAt: number;
  orders: { localId: string; cloudId: string; snapshot: string }[];
  financialRevision: string;
  state: "prepared" | "sending" | "sent";
  firstAttempt?: number;
  receiptId?: string;
  text: string;
  labEmail: string;
  labName: string;
  replyTo: string | null;
  date: string;
  sentAt?: string;
};
export async function POST(request: NextRequest) {
  try {
    const user = await productionAuth(request),
      b = schema.parse(await request.json());
    if (new Set(b.orders.map((o) => o.localId)).size !== b.orders.length)
      throw Error("Duplicate local orders.");
    const live = await currentProductionOrders(
      user.id,
      b.orders.map((o) => o.cloudId),
    );
    const revision = productionFinancialRevision(live.orders);
    const recordKey = productionKey(user.id, `batches/${b.batchId}.json`);
    let stored = await readProductionJson<Batch>(recordKey);
    const fingerprint = digest(
      JSON.stringify([
        b.batchId,
        b.zipSha256,
        b.labEmail.toLowerCase(),
        b.labName,
        b.turnaroundDays,
        [...b.orders].sort((a, b) => a.cloudId.localeCompare(b.cloudId)),
      ]),
    );
    if (stored && stored.value.fingerprint !== fingerprint)
      throw Error(
        "This batch already belongs to another recipient or print revision.",
      );
    if (!stored) {
      if (!b.key.startsWith(productionKey(user.id, "staging/")))
        throw Error("Wrong studio upload.");
      const ticket = await readProductionJson<{
        kind: string;
        sha256: string;
        bytes: number;
        expiresAt: number;
        orderIds: string[];
      }>(`${b.key}.json`);
      if (
        !ticket ||
        ticket.value.kind !== "batch" ||
        JSON.stringify([...ticket.value.orderIds].sort()) !==
          JSON.stringify(b.orders.map((o) => o.cloudId).sort()) ||
        ticket.value.sha256 !== b.zipSha256 ||
        ticket.value.expiresAt < Date.now()
      )
        throw Error("The ZIP upload expired. Retry delivery.");
      const upload = await readProduction(b.key, 256 * 1024 * 1024);
      if (
        upload.bytes.length !== ticket.value.bytes ||
        digest(upload.bytes) !== b.zipSha256
      )
        throw Error("The uploaded ZIP changed.");
      const verified = await verifyNoritsuZip(
        upload.bytes,
        user.id,
        b.orders.map((o) => o.localId),
      );
      const zipKey = productionKey(
        user.id,
        `zips/${b.batchId}-${b.zipSha256}.zip`,
      );
      try {
        await writeProduction(zipKey, upload.bytes, "application/zip", {
          create: true,
        });
      } catch {
        const previous = await readProduction(zipKey, 256 * 1024 * 1024);
        if (digest(previous.bytes) !== b.zipSha256)
          throw Error("ZIP publication needs review.");
      }
      if (
        digest((await readProduction(zipKey, 256 * 1024 * 1024)).bytes) !==
        b.zipSha256
      )
        throw Error(
          "The private ZIP readback hash is invalid. Delivery remains held.",
        );
      const token = randomBytes(32).toString("hex"),
        expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
      const date = new Date().toISOString().slice(0, 10);
      const link = `https://www.studiooscloud.com/api/order-automation/download?owner=${user.id}&batch=${b.batchId}&token=${token}`;
      const batch: Batch = {
        owner: user.id,
        fingerprint,
        zipKey,
        zipSha256: b.zipSha256,
        token,
        expiresAt,
        orders: b.orders,
        financialRevision: revision,
        state: "prepared",
        labEmail: b.labEmail,
        labName: b.labName,
        replyTo: live.studio.studio_email || user.email || null,
        date,
        text: labEmailText({
          labName: b.labName,
          orders: verified.orders,
          pieces: verified.pieces,
          days: b.turnaroundDays,
          link,
          studio: live.studio.business_name || "Studio OS",
          reference: b.batchId.slice(0, 12),
          date,
        }),
      };
      try {
        await writeProductionJson(recordKey, batch, { create: true });
      } catch {
        /* Concurrent exact batch wins, reread below. */
      }
      stored = await readProductionJson<Batch>(recordKey);
    }
    if (!stored || stored.value.fingerprint !== fingerprint)
      throw Error("The lab dispatch could not be reserved.");
    let batch = stored.value;
    if (batch.state === "sent")
      return NextResponse.json(
        {
          ok: true,
          state: "sent",
          receiptId: batch.receiptId,
          batchId: b.batchId,
          sentAt: batch.sentAt,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (batch.financialRevision !== revision)
      throw Error(
        "Order or payment details changed. Delivery is held for review.",
      );
    if (!resendConfigured())
      throw Error("The lab email provider is not configured.");
    // Reserve each exact order across batches and stations before external mail.
    for (const order of batch.orders) {
      const reservationKey = productionKey(
        user.id,
        `reservations/${digest(order.cloudId)}.json`,
      );
      const existing = await readProductionJson<{ batchId: string }>(
        reservationKey,
      );
      if (existing && existing.value.batchId !== b.batchId)
        throw Error(
          "An order is already reserved in another lab batch. Review delivery receipts.",
        );
      if (!existing) {
        try {
          await writeProductionJson(
            reservationKey,
            { batchId: b.batchId },
            { create: true },
          );
        } catch {
          const winner = await readProductionJson<{ batchId: string }>(
            reservationKey,
          );
          if (winner?.value.batchId !== b.batchId)
            throw Error("Another station reserved an order for delivery.");
        }
      }
    }
    const now = Date.now();
    if (batch.expiresAt <= now)
      throw Error(
        "The prepared private link expired. Review this batch before creating another delivery.",
      );
    if (batch.firstAttempt && now - batch.firstAttempt > 20 * 3600 * 1000)
      throw Error(
        "An old email attempt is unconfirmed. Reconcile it with the lab before resending.",
      );
    // A failed/unknown send retains the same frozen payload and idempotency key.
    if (
      batch.state === "sending" &&
      batch.firstAttempt &&
      now - batch.firstAttempt < 60000
    )
      throw Error("Lab email is in progress. Check receipts in a minute.");
    batch = {
      ...batch,
      state: "sending",
      firstAttempt: batch.firstAttempt || now,
    };
    await writeProductionJson(recordKey, batch, { etag: stored.etag });
    const finalLive = await currentProductionOrders(
      user.id,
      batch.orders.map((o) => o.cloudId),
    );
    if (
      productionFinancialRevision(finalLive.orders) !== batch.financialRevision
    )
      throw Error(
        "Order payment changed immediately before email. Delivery held.",
      );
    const escape = (v: string) =>
      v
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    const sent = await sendResendEmail({
      to: batch.labEmail,
      subject: `Print orders ${batch.date} — ${batch.orders.length} orders — ${b.batchId.slice(0, 12)}`,
      text: batch.text,
      html: `<div style="font-family:Arial;white-space:pre-wrap">${escape(batch.text)}</div>`,
      fromName: "Studio OS Print Orders",
      replyTo: batch.replyTo,
      idempotencyKey: `noritsu-${user.id}-${b.batchId}`,
      timeoutMs: 15000,
    });
    if (!sent.id)
      throw Error(
        "The provider did not return an email receipt. Check delivery before retrying.",
      );
    const current = await readProductionJson<Batch>(recordKey);
    if (!current || current.value.fingerprint !== fingerprint)
      throw Error("Email receipt needs reconciliation.");
    const receipt = {
      ...batch,
      state: "sent" as const,
      receiptId: sent.id,
      sentAt: new Date().toISOString(),
    };
    await writeProductionJson(recordKey, receipt, { etag: current.etag });
    return NextResponse.json(
      {
        ok: true,
        state: "sent",
        receiptId: sent.id,
        batchId: b.batchId,
        sentAt: receipt.sentAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof z.ZodError
            ? "Invalid lab batch details."
            : (error as Error).message,
      },
      { status: error instanceof ProductionAuthError ? error.status : 400 },
    );
  }
}
export async function GET(request: NextRequest) {
  try {
    const user = await productionAuth(request);
    const id = hash.parse(request.nextUrl.searchParams.get("batch"));
    const record = await readProductionJson<Batch>(
      productionKey(user.id, `batches/${id}.json`),
    );
    if (!record) throw Error("No delivery record yet.");
    return NextResponse.json(
      {
        ok: true,
        state: record.value.state,
        receiptId: record.value.receiptId,
        batchId: id,
        sentAt: record.value.sentAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: "Delivery receipt unavailable." },
      { status: 404 },
    );
  }
}
