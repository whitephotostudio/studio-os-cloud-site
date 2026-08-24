import { NextRequest, NextResponse } from "next/server";

import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { countR2FolderImages } from "@/lib/r2";
import { isUuid } from "@/lib/r2-access-security";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SCHOOLS_PER_REQUEST = 100;
const MAX_BODY_CHARS = 16_000;

type SchoolRow = {
  id: string;
  local_school_id: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

async function pooledForEach<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

// Count only the requested, photographer-owned schools. The grid calls this
// after it has rendered, so R2 pagination never blocks the Schools page.
export async function POST(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return privateJson({ ok: false, message: "Please sign in again." }, 401);
  }

  const service = createDashboardServiceClient();
  const agreement = await guardAgreement({ service, userId: user.id });
  if (!agreement.ok) {
    return privateJson(agreement.body, agreement.status);
  }

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (photographerError || !photographer?.id) {
    return privateJson(
      { ok: false, message: "Photographer profile not found." },
      403,
    );
  }

  const limit = await rateLimit(photographer.id, {
    namespace: "school-photo-counts",
    limit: 20,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return privateJson(
      { ok: false, message: "Too many count requests. Please wait a moment." },
      429,
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) {
    return privateJson({ ok: false, message: "Request is too large." }, 413);
  }

  let body: { schoolIds?: unknown };
  try {
    body = JSON.parse(rawBody) as { schoolIds?: unknown };
  } catch {
    return privateJson({ ok: false, message: "Invalid request." }, 400);
  }

  const requestedSchoolIds = Array.isArray(body.schoolIds)
    ? Array.from(
        new Set(
          body.schoolIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => clean(value))
            .filter((value) => isUuid(value)),
        ),
      )
    : [];

  if (requestedSchoolIds.length === 0) {
    return privateJson({ ok: true, counts: {}, sources: {} });
  }
  if (requestedSchoolIds.length > MAX_SCHOOLS_PER_REQUEST) {
    return privateJson(
      { ok: false, message: "Too many schools requested." },
      400,
    );
  }

  const { data: schoolRows, error: schoolsError } = await service
    .from("schools")
    .select("id,local_school_id")
    .eq("photographer_id", photographer.id)
    .in("id", requestedSchoolIds);

  if (schoolsError) {
    console.error("[dashboard:school-photo-counts] school lookup failed", {
      photographerId: photographer.id,
      error: schoolsError.message,
    });
    return privateJson(
      { ok: false, message: "Could not load school photo counts." },
      500,
    );
  }

  const counts: Record<string, number | null> = {};
  const sources: Record<string, "r2" | "unavailable"> = {};
  await pooledForEach((schoolRows ?? []) as SchoolRow[], 4, async (school) => {
    const prefix = clean(school.local_school_id) || clean(school.id);
    if (!prefix) {
      counts[school.id] = null;
      sources[school.id] = "unavailable";
      return;
    }

    try {
      counts[school.id] = await countR2FolderImages(prefix);
      sources[school.id] = "r2";
    } catch (error) {
      console.warn("[dashboard:school-photo-counts] R2 count unavailable", {
        schoolId: school.id,
        error: error instanceof Error ? error.name : "UnknownError",
      });

      // Do not guess from legacy database rows: older school uploads did not
      // consistently create one media row per original. Hide the badge until
      // an authoritative R2 count is available.
      counts[school.id] = null;
      sources[school.id] = "unavailable";
    }
  });

  return privateJson({ ok: true, counts, sources });
}
