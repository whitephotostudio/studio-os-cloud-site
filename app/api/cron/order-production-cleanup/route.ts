import { NextRequest, NextResponse } from "next/server";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import {
  readProductionJson,
  writeProductionJson,
} from "@/lib/order-automation-storage";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const cursorKey = "order-automation/cleanup/cursor.json";
    const saved = await readProductionJson<{ cursor?: string }>(cursorKey);
    let cursor = saved?.value.cursor;
    let removed = 0;
    for (let page = 0; page < 3; page++) {
      const result = await getR2Client().send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: "order-automation/",
          MaxKeys: 1000,
          ContinuationToken: cursor,
        }),
      );
      const stale = (result.Contents || []).filter((o) => {
        const age = Date.now() - (o.LastModified?.getTime() || Date.now());
        return Boolean(
          o.Key &&
            ((/\/staging\//.test(o.Key) && age > 24 * 3600 * 1000) ||
              (/\/zips\//.test(o.Key) && age > 8 * 24 * 3600 * 1000) ||
              (/\/privacy-probe\//.test(o.Key) && age > 24 * 3600 * 1000)),
        );
      });
      if (stale.length) {
        const deleted = await getR2Client().send(
          new DeleteObjectsCommand({
            Bucket: R2_BUCKET,
            Delete: {
              Objects: stale.map((o) => ({ Key: o.Key! })),
              Quiet: true,
            },
          }),
        );
        if (deleted.Errors?.length) throw Error("Cleanup incomplete");
        removed += stale.length;
      }
      cursor = result.IsTruncated ? result.NextContinuationToken : undefined;
      if (!cursor) break;
    }
    await writeProductionJson(
      cursorKey,
      { cursor: cursor || null },
      { ...(saved ? { etag: saved.etag } : { create: true }) },
    );
    return NextResponse.json({ ok: true, removed, more: Boolean(cursor) });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Production archive cleanup needs retry." },
      { status: 503 },
    );
  }
}
