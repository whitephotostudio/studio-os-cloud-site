import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { storageClientFor } from "@/lib/r2";
import { enterPhotographerStorage, selectPhotographerStorage } from "@/lib/photographer-storage";
import {
  normalizeR2Key,
} from "@/lib/r2-access-security";
import {
  r2PresignedGetUrl,
  r2PresignedPutUrl,
} from "@/lib/r2-signed-urls";
import { rateLimit } from "@/lib/rate-limit";
import { r2MediaOwnedBy } from "@/lib/r2-media-ownership";
import { authorizedCutoutBindings, CreditCutoutAccessError, isManagedCutoutKey, readPaidCutout, signVerifiedCutout } from "@/lib/credit-cutout-access";

export const runtime = "nodejs";

type ServiceClient = ReturnType<typeof createDashboardServiceClient>;

const ALLOWED_UPLOAD_TYPES = new Set([
  "application/octet-stream",
  "image/avif",
  "image/heic",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "text/plain",
]);
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_LIST_PAGE_SIZE = 1000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function authorizeKey(
  service: ServiceClient,
  photographerId: string,
  rawKey: unknown,
  options: { prefix?: boolean } = {},
) {
  if (typeof rawKey !== "string") return null;
  const key = normalizeR2Key(rawKey, options);
  if (!key) return null;
  // Durable first-owner claims include retained local-school aliases and reject
  // foreign, ambiguous, deleted and server-only namespaces.
  return await r2MediaOwnedBy(service, key, photographerId, options) ? key : null;
}

function isMissingObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey"
  );
}

export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (auth.mfaSatisfied === false) return jsonError("Complete two-step verification before accessing photos.", 403);
  if (!auth.user) return jsonError("Unauthorized", 401);

  const service = createDashboardServiceClient();
  const { data: photographer, error: photographerError } = await selectPhotographerStorage(service, "user_id", auth.user.id);
  if (photographerError || !photographer?.id) {
    return jsonError("Photographer profile not found.", 403);
  }
  // Every grant below is signed for the photographer's own storage region.
  const region = enterPhotographerStorage(photographer);

  const agreement = await guardAgreement({ service, userId: auth.user.id });
  if (!agreement.ok) {
    return NextResponse.json(agreement.body, { status: agreement.status });
  }

  const limit = await rateLimit(photographer.id, {
    namespace: "dashboard-r2-access",
    limit: 6000,
    windowSeconds: 600,
  });
  if (!limit.allowed) return jsonError("Too many storage requests.", 429);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Invalid request.", 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError("Invalid request.", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "sign-upload") {
      const key = await authorizeKey(service, photographer.id, body.key);
      if (!key) return jsonError("You cannot upload to that path.", 403);
      if (isManagedCutoutKey(key)) return jsonError("Cutouts require a verified paid photo and a direct Studio OS upload.", 403);

      const contentType =
        typeof body.contentType === "string"
          ? body.contentType.trim().toLowerCase()
          : "";
      const contentLength =
        typeof body.contentLength === "number" ? body.contentLength : NaN;
      if (!ALLOWED_UPLOAD_TYPES.has(contentType)) {
        return jsonError("Unsupported upload type.", 400);
      }
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 1 ||
        contentLength > MAX_UPLOAD_BYTES
      ) {
        return jsonError("Invalid upload size.", 400);
      }

      const url = r2PresignedPutUrl(key, 15 * 60, { contentLength, contentType, region });
      if (!url) throw new Error("R2 signing is unavailable");
      return NextResponse.json({
        ok: true,
        key,
        url,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=60, must-revalidate",
        },
        expiresIn: 15 * 60,
      });
    }

    if (action === "sign-download") {
      const key = await authorizeKey(service, photographer.id, body.key);
      if (!key) return jsonError("You cannot download that path.", 403);
      if (isManagedCutoutKey(key)) await readPaidCutout(service, photographer.id, key);
      const url = isManagedCutoutKey(key) ? signVerifiedCutout(key) : r2PresignedGetUrl(key, 60 * 60, { region });
      if (!url) throw new Error("R2 signing is unavailable");
      return NextResponse.json({
        ok: true,
        key,
        url,
        expiresIn: isManagedCutoutKey(key) ? 300 : 60 * 60,
      });
    }

    if (action === "exists") {
      const key = await authorizeKey(service, photographer.id, body.key);
      if (!key) return jsonError("You cannot inspect that path.", 403);
      if (isManagedCutoutKey(key)) {
        await readPaidCutout(service, photographer.id, key);
        return NextResponse.json({ ok: true, key, exists: true });
      }
      try {
        const storage = storageClientFor(region);
        await storage.client.send(
          new HeadObjectCommand({ Bucket: storage.bucket, Key: key }),
        );
        return NextResponse.json({ ok: true, key, exists: true });
      } catch (error) {
        if (isMissingObjectError(error)) {
          return NextResponse.json({ ok: true, key, exists: false });
        }
        throw error;
      }
    }

    if (action === "list") {
      const prefix = await authorizeKey(service, photographer.id, body.prefix, {
        prefix: true,
      });
      if (!prefix) return jsonError("You cannot list that path.", 403);
      const continuationToken =
        typeof body.continuationToken === "string" &&
        body.continuationToken.length <= 4096
          ? body.continuationToken
          : undefined;
      const storage = storageClientFor(region);
      const page = await storage.client.send(
        new ListObjectsV2Command({
          Bucket: storage.bucket,
          Prefix: prefix,
          MaxKeys: MAX_LIST_PAGE_SIZE,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (page.Contents ?? []).map(item => item.Key ?? "").filter(key => key.startsWith(prefix));
      const paidKeys = await authorizedCutoutBindings(service, photographer.id, keys);
      return NextResponse.json({
        ok: true,
        prefix,
        keys: keys.filter(key => !isManagedCutoutKey(key) || paidKeys.has(key)),
        nextContinuationToken: page.IsTruncated
          ? page.NextContinuationToken ?? null
          : null,
      });
    }

    return jsonError("Unsupported storage action.", 400);
  } catch (error) {
    if (error instanceof CreditCutoutAccessError) return jsonError(error.message, 403);
    console.error("[r2-access] storage request failed", {
      action,
      photographerId: photographer.id,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError("Storage request failed.", 502);
  }
}
