import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ProductionAuthError,
  productionAuth,
  currentProductionOrders,
} from "@/lib/order-automation-auth";
import {
  productionKey,
  writeProductionJson,
} from "@/lib/order-automation-storage";
import { r2PresignedPutUrl } from "@/lib/r2-signed-urls";
import { ensureProductionStoragePrivate } from "@/lib/order-automation-privacy";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    orderIds: z.array(z.string().uuid()).min(1).max(100),
    kind: z.enum(["portrait", "batch"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .positive()
      .max(256 * 1024 * 1024),
  })
  .strict();
export async function POST(request: NextRequest) {
  try {
    const user = await productionAuth(request);
    const b = schema.parse(await request.json());
    await currentProductionOrders(user.id, b.orderIds);
    await ensureProductionStoragePrivate();
    if (b.kind === "portrait" && b.bytes > 64 * 1024 * 1024)
      throw Error("Print image exceeds the review limit.");
    const id = randomUUID();
    const key = productionKey(user.id, `staging/${id}`);
    const type = b.kind === "portrait" ? "image/jpeg" : "application/zip";
    const url = r2PresignedPutUrl(key, 120, {
      allowOrderAutomation: true,
      contentLength: b.bytes,
      contentType: type,
    });
    if (!url) throw Error("Private uploads are not configured.");
    await writeProductionJson(
      `${key}.json`,
      { ...b, key, owner: user.id, expiresAt: Date.now() + 10 * 60 * 1000 },
      { create: true },
    );
    return NextResponse.json(
      { ok: true, key, url, contentType: type },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof z.ZodError
            ? "Invalid production upload."
            : (error as Error).message,
      },
      { status: error instanceof ProductionAuthError ? error.status : 400 },
    );
  }
}
