import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import {
  isUuid,
  normalizeR2Key,
  scopeForR2Key,
  type R2ResourceScope,
} from "@/lib/r2-access-security";
import {
  r2PresignedGetUrl,
  r2PresignedPutUrl,
} from "@/lib/r2-signed-urls";
import { rateLimit } from "@/lib/rate-limit";

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

async function photographerOwnsScope(
  service: ServiceClient,
  photographerId: string,
  scope: R2ResourceScope,
) {
  if (scope.kind === "photographer") return scope.id === photographerId;

  if (scope.kind === "project") {
    if (!isUuid(scope.id)) return false;
    const { data, error } = await service
      .from("projects")
      .select("id")
      .eq("id", scope.id)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  }

  if (isUuid(scope.id)) {
    const { data: schoolById, error: schoolByIdError } = await service
      .from("schools")
      .select("id")
      .eq("photographer_id", photographerId)
      .eq("id", scope.id)
      .maybeSingle();
    if (schoolByIdError) throw schoolByIdError;
    if (schoolById?.id) return true;
  }

  const { data: schoolByLocalId, error: schoolByLocalIdError } = await service
    .from("schools")
    .select("id")
    .eq("photographer_id", photographerId)
    .eq("local_school_id", scope.id)
    .maybeSingle();
  if (schoolByLocalIdError) throw schoolByLocalIdError;
  return Boolean(schoolByLocalId?.id);
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
  const scope = scopeForR2Key(key);
  if (!scope) return null;
  return (await photographerOwnsScope(service, photographerId, scope))
    ? key
    : null;
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
  if (!auth.user) return jsonError("Unauthorized", 401);

  const service = createDashboardServiceClient();
  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (photographerError || !photographer?.id) {
    return jsonError("Photographer profile not found.", 403);
  }

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

      const url = r2PresignedPutUrl(key, 15 * 60);
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
      const url = r2PresignedGetUrl(key, 60 * 60);
      if (!url) throw new Error("R2 signing is unavailable");
      return NextResponse.json({
        ok: true,
        key,
        url,
        expiresIn: 60 * 60,
      });
    }

    if (action === "exists") {
      const key = await authorizeKey(service, photographer.id, body.key);
      if (!key) return jsonError("You cannot inspect that path.", 403);
      try {
        await getR2Client().send(
          new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
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
      const page = await getR2Client().send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: prefix,
          MaxKeys: MAX_LIST_PAGE_SIZE,
          ContinuationToken: continuationToken,
        }),
      );
      return NextResponse.json({
        ok: true,
        prefix,
        keys: (page.Contents ?? [])
          .map((item) => item.Key ?? "")
          .filter((key) => key.startsWith(prefix)),
        nextContinuationToken: page.IsTruncated
          ? page.NextContinuationToken ?? null
          : null,
      });
    }

    return jsonError("Unsupported storage action.", 400);
  } catch (error) {
    console.error("[r2-access] storage request failed", {
      action,
      photographerId: photographer.id,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError("Storage request failed.", 502);
  }
}
