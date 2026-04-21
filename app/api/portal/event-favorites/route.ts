import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  workflow_type: string | null;
  status: string | null;
  email_required: boolean | null;
  access_mode: string | null;
  access_pin: string | null;
};

type FavoriteRow = {
  media_id: string | null;
};

type CollectionAccessRow = {
  id: string;
  slug: string | null;
  access_mode: string | null;
  access_pin: string | null;
};

type MediaRow = {
  id: string;
  collection_id: string | null;
};

function isMissingFavoritesTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  if (raw === "inherit" || raw === "inherit_project" || raw === "project") return "inherit_project";
  return raw;
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function isEventProject(row: Pick<ProjectRow, "workflow_type">) {
  return clean(row.workflow_type).toLowerCase() === "event";
}

function matchesProjectPin(row: Pick<ProjectRow, "access_mode" | "access_pin">, pin: string) {
  return normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin;
}

function matchesCollectionPin(row: CollectionAccessRow, pin: string) {
  return clean(row.slug) === pin || (normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin);
}

function viewerKey(projectId: string, email: string, pin: string) {
  return createHash("sha256")
    .update(`${projectId}::${email.toLowerCase()}::${pin}`)
    .digest("hex");
}

async function validateEventAccess(params: {
  projectId: string;
  email: string;
  pin: string;
}) {
  const service = createDashboardServiceClient();
  const selectedProjectId = clean(params.projectId);
  const normalizedEmail = clean(params.email).toLowerCase();
  const pinValue = clean(params.pin);

  const { data: projectRow, error: projectError } = await service
    .from("projects")
    .select("id,workflow_type,status,email_required,access_mode,access_pin")
    .eq("id", selectedProjectId)
    .maybeSingle<ProjectRow>();

  if (projectError) throw projectError;
  if (!projectRow || !isEventProject(projectRow) || isInactive(projectRow.status)) {
    return { ok: false as const, status: 404, message: "Event gallery not found." };
  }

  const { data: whitelistRows, error: whitelistError } = await service
    .from("pre_release_emails")
    .select("id")
    .eq("project_id", selectedProjectId)
    .eq("email", normalizedEmail)
    .limit(1);

  if (whitelistError) throw whitelistError;

  const emailRequired = projectRow.email_required !== false;
  if (emailRequired && (whitelistRows?.length ?? 0) === 0) {
    const { data: anyWhitelist, error: anyWhitelistError } = await service
      .from("pre_release_emails")
      .select("id")
      .eq("project_id", selectedProjectId)
      .limit(1);

    if (anyWhitelistError) throw anyWhitelistError;

    if ((anyWhitelist?.length ?? 0) > 0) {
      return {
        ok: false as const,
        status: 403,
        message: "That email is not approved for this event gallery.",
      };
    }
  }

  const [matchingSubjectResult, collectionAccessResult] = await Promise.all([
    service
      .from("subjects")
      .select("id")
      .eq("project_id", selectedProjectId)
      .eq("external_ref", pinValue)
      .limit(1)
      .maybeSingle(),
    service
      .from("collections")
      .select("id,slug,access_mode,access_pin")
      .eq("project_id", selectedProjectId),
  ]);

  if (matchingSubjectResult.error) throw matchingSubjectResult.error;
  if (collectionAccessResult.error) throw collectionAccessResult.error;

  const matchingCollection = ((collectionAccessResult.data ?? []) as CollectionAccessRow[]).find((row) =>
    matchesCollectionPin(row, pinValue),
  );
  const projectPinMatch = matchesProjectPin(projectRow, pinValue);

  if (!projectPinMatch && !matchingSubjectResult.data && !matchingCollection) {
    return {
      ok: false as const,
      status: 404,
      message: "No event gallery was found for that email and PIN.",
    };
  }

  return {
    ok: true as const,
    service,
    projectId: selectedProjectId,
    email: normalizedEmail,
    pin: pinValue,
    key: viewerKey(selectedProjectId, normalizedEmail, pinValue),
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const access = await validateEventAccess({
      projectId: searchParams.get("projectId") ?? "",
      email: searchParams.get("email") ?? "",
      pin: searchParams.get("pin") ?? "",
    });

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status },
      );
    }

    const { data, error } = await access.service
      .from("event_gallery_favorites")
      .select("media_id")
      .eq("project_id", access.projectId)
      .eq("viewer_key", access.key)
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingFavoritesTable(error)) {
        return NextResponse.json({
          ok: true,
          mediaIds: [],
          unavailable: true,
          message: "Event favorites are still using local browser state until the database update is applied.",
        });
      }
      throw error;
    }

    const mediaIds = ((data ?? []) as FavoriteRow[])
      .map((row) => clean(row.media_id))
      .filter((value) => value.length > 0);

    return NextResponse.json({
      ok: true,
      mediaIds,
    });
  } catch (error) {
    // Log the real error server-side; return a generic message to the
    // caller so DB/internal details don't leak to anonymous visitors.
    console.error("[event-favorites:GET]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load event favorites." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Cap favorite toggle rate per IP. Each toggle does a DB upsert/delete;
    // without a limit a script could spam the favorites table. 60/min is
    // far above any plausible human browsing rate.
    const limitResult = rateLimit(getClientIp(request), {
      namespace: "event-favorites",
      limit: 60,
      windowSeconds: 60,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many updates. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      projectId?: string;
      email?: string;
      pin?: string;
      mediaId?: string;
      favorited?: boolean;
    };

    const access = await validateEventAccess({
      projectId: body.projectId ?? "",
      email: body.email ?? "",
      pin: body.pin ?? "",
    });

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status },
      );
    }

    const mediaId = clean(body.mediaId);
    if (!mediaId) {
      return NextResponse.json(
        { ok: false, message: "Missing media id." },
        { status: 400 },
      );
    }

    const { data: mediaRow, error: mediaError } = await access.service
      .from("media")
      .select("id,collection_id")
      .eq("id", mediaId)
      .eq("project_id", access.projectId)
      .maybeSingle<MediaRow>();

    if (mediaError) throw mediaError;
    if (!mediaRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photo not found in this event gallery." },
        { status: 404 },
      );
    }

    const shouldFavorite = body.favorited !== false;

    if (shouldFavorite) {
      const { error } = await access.service
        .from("event_gallery_favorites")
        .upsert(
          {
            project_id: access.projectId,
            media_id: mediaRow.id,
            collection_id: clean(mediaRow.collection_id) || null,
            viewer_email: access.email,
            viewer_key: access.key,
          },
          {
            onConflict: "project_id,media_id,viewer_key",
            ignoreDuplicates: false,
          },
        );

      if (error) {
        if (isMissingFavoritesTable(error)) {
          return NextResponse.json({
            ok: true,
            mediaId: mediaRow.id,
            favorited: shouldFavorite,
            unavailable: true,
            message: "Event favorites are still local-only until the database update is applied.",
          });
        }
        throw error;
      }
    } else {
      const { error } = await access.service
        .from("event_gallery_favorites")
        .delete()
        .eq("project_id", access.projectId)
        .eq("media_id", mediaRow.id)
        .eq("viewer_key", access.key);

      if (error) {
        if (isMissingFavoritesTable(error)) {
          return NextResponse.json({
            ok: true,
            mediaId: mediaRow.id,
            favorited: shouldFavorite,
            unavailable: true,
            message: "Event favorites are still local-only until the database update is applied.",
          });
        }
        throw error;
      }
    }

    return NextResponse.json({
      ok: true,
      mediaId: mediaRow.id,
      favorited: shouldFavorite,
    });
  } catch (error) {
    console.error("[event-favorites:POST]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to save event favorite." },
      { status: 500 },
    );
  }
}
