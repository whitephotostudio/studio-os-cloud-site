// Studio Assistant — server-side executor.
//
// Phase 2 dispatches a parsed + validated command to one of the allowlisted
// handlers below.  Every handler is scoped to a resolved photographer_id and
// uses the service-role client created by the API route.
//
// Handlers reuse existing business logic where possible (ensurePackageProfile,
// school status vocabulary) rather than reimplementing it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePackageProfile } from "@/lib/ensure-package-profile";
import {
  StudioAssistantIntent,
  isWriteIntent,
} from "@/lib/studio-assistant/types";
import {
  reviewExpiringGalleries,
  reviewReleaseWarnings,
  reviewUnreleasedWithPreregistrations,
  summarizeAttentionItems,
  summarizeOrderBacklog,
  summarizePackagePerformance,
  summarizePendingDigitalOrders,
  summarizeSalesBySchool,
  summarizeToday,
  summarizeWeek,
} from "./insights";
import {
  highlightPopularMedia,
  reviewGalleryCoverage,
  suggestGalleryCover,
  suggestUpsellSizes,
} from "./gallery-insights";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type ExecutorContext = {
  service: SupabaseClient;
  photographerId: string;
  userId: string;
};

export type ExecutorInput = {
  intent: StudioAssistantIntent;
  params: Record<string, unknown>;
  confirmed: boolean;
};

export type ExecutorSuccess = {
  ok: true;
  data: Record<string, unknown>;
  message: string;
};

export type ExecutorFailure = {
  ok: false;
  message: string;
  /** HTTP-ish code for the API route. */
  status: 400 | 403 | 404 | 409 | 422 | 500;
};

export type ExecutorResult = ExecutorSuccess | ExecutorFailure;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asString(value: unknown): string | null {
  const trimmed = clean(value);
  return trimmed ? trimmed : null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

/**
 * Parse a simple YYYY-MM-DD date.  Everything else is rejected so we don't
 * accidentally write garbage into shoot_date / event_date columns.
 */
function asIsoDate(value: unknown): string | null {
  const s = clean(value);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/** ilike-safe — escape % and _ before composing patterns. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function findSchoolByName(params: {
  service: SupabaseClient;
  photographerId: string;
  name: string;
}) {
  const like = `%${escapeLike(params.name)}%`;
  const { data, error } = await params.service
    .from("schools")
    .select(
      "id,school_name,local_school_id,status,shoot_date,order_due_date,access_mode,package_profile_id",
    )
    .eq("photographer_id", params.photographerId)
    .ilike("school_name", like)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/*  Handlers — write intents                                                  */
/* -------------------------------------------------------------------------- */

async function handleCreateSchool(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const schoolName = asString(raw.school_name);
  const eventDate = asIsoDate(raw.event_date);

  if (!schoolName) {
    return { ok: false, status: 422, message: "School name is required." };
  }

  const localId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const insertRow: Record<string, unknown> = {
    school_name: schoolName,
    photographer_id: ctx.photographerId,
    local_school_id: localId,
    status: "pre_release",
    email_required: true,
  };
  if (eventDate) insertRow.shoot_date = eventDate;

  const { data, error } = await ctx.service
    .from("schools")
    .insert(insertRow)
    .select("id,school_name,status,shoot_date,created_at")
    .single();

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message || "Unable to create school.",
    };
  }

  return {
    ok: true,
    data: { school: data },
    message: `Created school “${data.school_name}”.`,
  };
}

async function handleUpdateSchoolDates(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const name = asString(raw.school_name);
  const newDate = asIsoDate(raw.new_date);
  if (!name) {
    return { ok: false, status: 422, message: "School name is required." };
  }
  if (!newDate) {
    return {
      ok: false,
      status: 422,
      message: "A valid YYYY-MM-DD date is required.",
    };
  }

  const matches = await findSchoolByName({
    service: ctx.service,
    photographerId: ctx.photographerId,
    name,
  });
  if (!matches.length) {
    return { ok: false, status: 404, message: `No school found matching “${name}”.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      message: `Multiple schools match “${name}”. Please be more specific.`,
    };
  }

  const school = matches[0];
  const { data, error } = await ctx.service
    .from("schools")
    .update({ shoot_date: newDate })
    .eq("id", school.id)
    .eq("photographer_id", ctx.photographerId)
    .select("id,school_name,shoot_date,status")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message || "Unable to update school dates.",
    };
  }
  if (!data) {
    return { ok: false, status: 404, message: "School not found after update." };
  }

  return {
    ok: true,
    data: { school: data },
    message: `Moved “${data.school_name}” shoot date to ${newDate}.`,
  };
}

async function handleAssignPackageProfile(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const destName = asString(raw.destination_school);
  const sourceName = asString(raw.source_school);
  if (!destName) {
    return { ok: false, status: 422, message: "Destination school is required." };
  }
  if (!sourceName) {
    return {
      ok: false,
      status: 422,
      message: "Source school (or package profile) is required.",
    };
  }

  const [destMatches, sourceMatches] = await Promise.all([
    findSchoolByName({
      service: ctx.service,
      photographerId: ctx.photographerId,
      name: destName,
    }),
    findSchoolByName({
      service: ctx.service,
      photographerId: ctx.photographerId,
      name: sourceName,
    }),
  ]);

  if (!destMatches.length) {
    return {
      ok: false,
      status: 404,
      message: `No destination school found matching “${destName}”.`,
    };
  }
  if (destMatches.length > 1) {
    return {
      ok: false,
      status: 409,
      message: `Multiple destination schools match “${destName}”. Please be more specific.`,
    };
  }
  if (!sourceMatches.length) {
    return {
      ok: false,
      status: 404,
      message: `No source school found matching “${sourceName}”.`,
    };
  }
  if (sourceMatches.length > 1) {
    return {
      ok: false,
      status: 409,
      message: `Multiple source schools match “${sourceName}”. Please be more specific.`,
    };
  }

  const source = sourceMatches[0];
  const dest = destMatches[0];
  const sourceProfileId = source.package_profile_id as string | null;
  if (!sourceProfileId) {
    return {
      ok: false,
      status: 422,
      message: `“${source.school_name}” has no package profile to copy.`,
    };
  }

  const resolvedProfileId = await ensurePackageProfile({
    service: ctx.service,
    photographerId: ctx.photographerId,
    packageProfileId: sourceProfileId,
  });
  if (!resolvedProfileId) {
    return {
      ok: false,
      status: 422,
      message: "Source package profile could not be resolved.",
    };
  }

  const { data, error } = await ctx.service
    .from("schools")
    .update({ package_profile_id: resolvedProfileId })
    .eq("id", dest.id)
    .eq("photographer_id", ctx.photographerId)
    .select("id,school_name,package_profile_id")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message || "Unable to assign package profile.",
    };
  }

  return {
    ok: true,
    data: {
      school: data,
      source_school: { id: source.id, name: source.school_name },
    },
    message: `Copied pricing from “${source.school_name}” to “${dest.school_name}”.`,
  };
}

async function handleReleaseSchoolGallery(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const name = asString(raw.school_name);
  if (!name) {
    return { ok: false, status: 422, message: "School name is required." };
  }

  const matches = await findSchoolByName({
    service: ctx.service,
    photographerId: ctx.photographerId,
    name,
  });
  if (!matches.length) {
    return { ok: false, status: 404, message: `No school found matching “${name}”.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      message: `Multiple schools match “${name}”. Please be more specific.`,
    };
  }
  const school = matches[0];
  // Release = move to "active" so parents portal becomes live.  This matches
  // the vocabulary `isLivePortalStatus` already recognises in the schools
  // detail route.
  const { data, error } = await ctx.service
    .from("schools")
    .update({ status: "active" })
    .eq("id", school.id)
    .eq("photographer_id", ctx.photographerId)
    .select("id,school_name,status")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message || "Unable to release gallery.",
    };
  }

  return {
    ok: true,
    data: { school: data },
    message: `Released “${data?.school_name ?? name}” gallery. Existing email campaigns will fire from the schools detail API as usual.`,
  };
}

async function handleToggleSchoolAccess(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const name = asString(raw.school_name);
  if (!name) {
    return { ok: false, status: 422, message: "School name is required." };
  }
  const enabled = asBool(raw.access_enabled, true);

  const matches = await findSchoolByName({
    service: ctx.service,
    photographerId: ctx.photographerId,
    name,
  });
  if (!matches.length) {
    return { ok: false, status: 404, message: `No school found matching “${name}”.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      message: `Multiple schools match “${name}”. Please be more specific.`,
    };
  }
  const school = matches[0];

  // "lock" = set to archived (parents portal will refuse access).
  // "unlock" = set to active.  These vocabulary choices mirror existing
  // portal_status handling elsewhere in the app.
  const nextStatus = enabled ? "active" : "archived";

  const { data, error } = await ctx.service
    .from("schools")
    .update({ status: nextStatus })
    .eq("id", school.id)
    .eq("photographer_id", ctx.photographerId)
    .select("id,school_name,status")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message || "Unable to toggle school access.",
    };
  }

  return {
    ok: true,
    data: { school: data, access_enabled: enabled },
    message: `${enabled ? "Unlocked" : "Locked"} access for “${data?.school_name ?? name}”.`,
  };
}

/* -------------------------------------------------------------------------- */
/*  Handlers — read intents                                                   */
/* -------------------------------------------------------------------------- */

async function handleFindSchool(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const query = asString(raw.query);
  if (!query) {
    return { ok: false, status: 422, message: "Enter a school name to search." };
  }
  const matches = await findSchoolByName({
    service: ctx.service,
    photographerId: ctx.photographerId,
    name: query,
  });
  return {
    ok: true,
    data: { query, results: matches },
    message: matches.length
      ? `Found ${matches.length} school${matches.length === 1 ? "" : "s"} matching “${query}”.`
      : `No schools match “${query}”.`,
  };
}

async function handleFindStudent(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const query = asString(raw.query);
  if (!query) {
    return { ok: false, status: 422, message: "Enter a student name to search." };
  }

  // First, find this photographer's schools so we can scope the student query.
  const { data: schoolRows, error: schoolErr } = await ctx.service
    .from("schools")
    .select("id,school_name")
    .eq("photographer_id", ctx.photographerId)
    .limit(500);

  if (schoolErr) {
    return {
      ok: false,
      status: 500,
      message: schoolErr.message || "Unable to load schools.",
    };
  }
  const schools = schoolRows ?? [];
  if (!schools.length) {
    return {
      ok: true,
      data: { query, results: [] },
      message: `No students found (no schools yet).`,
    };
  }

  const schoolIds = schools.map((s) => s.id as string);
  const schoolNameById = new Map(schools.map((s) => [s.id as string, s.school_name as string | null]));

  const like = `%${escapeLike(query)}%`;
  const { data: studentRows, error: studentErr } = await ctx.service
    .from("students")
    .select("id,school_id,first_name,last_name,class_name,photo_url")
    .in("school_id", schoolIds)
    .or(`first_name.ilike.${like},last_name.ilike.${like}`)
    .limit(25);

  if (studentErr) {
    return {
      ok: false,
      status: 500,
      message: studentErr.message || "Unable to search students.",
    };
  }
  const results = (studentRows ?? []).map((row) => ({
    id: row.id,
    school_id: row.school_id,
    school_name: schoolNameById.get(row.school_id as string) ?? null,
    first_name: row.first_name,
    last_name: row.last_name,
    class_name: row.class_name,
    photo_url: row.photo_url,
  }));

  return {
    ok: true,
    data: { query, results },
    message: results.length
      ? `Found ${results.length} student${results.length === 1 ? "" : "s"} matching “${query}”.`
      : `No students match “${query}”.`,
  };
}

async function handleListNewOrders(
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
): Promise<ExecutorResult> {
  const since = asIsoDate(raw.since) ?? new Date().toISOString().slice(0, 10);
  const sinceIso = `${since}T00:00:00Z`;

  const { data, error } = await ctx.service
    .from("orders")
    .select("id,customer_name,total_cents,status,created_at")
    .eq("photographer_id", ctx.photographerId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message || "Unable to load orders.",
    };
  }

  const rows = data ?? [];
  return {
    ok: true,
    data: { since, results: rows },
    message: rows.length
      ? `Found ${rows.length} order${rows.length === 1 ? "" : "s"} since ${since}.`
      : `No new orders since ${since}.`,
  };
}

/* -------------------------------------------------------------------------- */
/*  Dispatch                                                                  */
/* -------------------------------------------------------------------------- */

export async function executeAssistantAction(
  ctx: ExecutorContext,
  input: ExecutorInput,
): Promise<ExecutorResult> {
  if (!ctx.photographerId) {
    return { ok: false, status: 403, message: "Photographer profile not resolved." };
  }

  // Confirmation guard — any write intent MUST arrive with confirmed=true.
  // Read intents don't need it and will silently ignore the flag.
  if (isWriteIntent(input.intent) && !input.confirmed) {
    return {
      ok: false,
      status: 422,
      message: "This is a write action. Confirm in the panel before running.",
    };
  }

  try {
    switch (input.intent) {
      case "create_school":
        return await handleCreateSchool(ctx, input.params);
      case "update_school_dates":
        return await handleUpdateSchoolDates(ctx, input.params);
      case "assign_package_profile":
        return await handleAssignPackageProfile(ctx, input.params);
      case "release_school_gallery":
        return await handleReleaseSchoolGallery(ctx, input.params);
      case "toggle_school_access":
        return await handleToggleSchoolAccess(ctx, input.params);
      case "find_school":
        return await handleFindSchool(ctx, input.params);
      case "find_student":
        return await handleFindStudent(ctx, input.params);
      case "list_new_orders":
        return await handleListNewOrders(ctx, input.params);

      // ── Phase 5 — read-only insights ──────────────────────────────────
      case "summarize_attention_items": {
        const data = await summarizeAttentionItems(ctx);
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: data.counts.needs_attention
            ? `${data.counts.needs_attention} school${data.counts.needs_attention === 1 ? "" : "s"} need attention.`
            : "Nothing urgent right now.",
        };
      }
      case "summarize_pending_digital_orders": {
        const data = await summarizePendingDigitalOrders(ctx);
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message:
            data.counts.total_orders > 0
              ? `${data.counts.total_orders} digital order${data.counts.total_orders === 1 ? "" : "s"} pending.`
              : "No digital orders are pending.",
        };
      }
      case "summarize_sales_by_school": {
        const data = await summarizeSalesBySchool(ctx, {
          since: asString(input.params.since),
        });
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: `Sales across ${data.counts.schools} school${data.counts.schools === 1 ? "" : "s"} since ${data.since}.`,
        };
      }
      case "summarize_package_performance": {
        const data = await summarizePackagePerformance(ctx, {
          since: asString(input.params.since),
        });
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: `${data.counts.packages} package${data.counts.packages === 1 ? "" : "s"} tracked since ${data.since}.`,
        };
      }
      case "review_release_warnings": {
        const data = await reviewReleaseWarnings(ctx);
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: data.counts.schools
            ? `${data.counts.schools} school${data.counts.schools === 1 ? "" : "s"} not ready to release.`
            : "All active schools look ready to release.",
        };
      }
      case "review_expiring_galleries": {
        const withinRaw = input.params.within_days;
        const withinDays =
          typeof withinRaw === "number"
            ? withinRaw
            : typeof withinRaw === "string"
              ? Number.parseInt(withinRaw, 10)
              : null;
        const data = await reviewExpiringGalleries(ctx, {
          within_days: Number.isFinite(withinDays) ? (withinDays as number) : 7,
        });
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: data.counts.schools
            ? `${data.counts.schools} galler${data.counts.schools === 1 ? "y expires" : "ies expire"} within ${data.within_days} days.`
            : `No galleries expire within ${data.within_days} days.`,
        };
      }
      case "review_unreleased_with_preregistrations": {
        const data = await reviewUnreleasedWithPreregistrations(ctx);
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: data.counts.schools
            ? `${data.counts.schools} unreleased school${data.counts.schools === 1 ? "" : "s"} already have preregistrations.`
            : "No unreleased schools with preregistrations right now.",
        };
      }
      case "summarize_order_backlog": {
        const data = await summarizeOrderBacklog(ctx);
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: data.counts.total_orders
            ? `${data.counts.total_orders} order${data.counts.total_orders === 1 ? "" : "s"} in backlog.`
            : "No orders in backlog.",
        };
      }
      case "summarize_today": {
        const data = await summarizeToday(ctx);
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: `${data.counts.new_orders_today} new order${data.counts.new_orders_today === 1 ? "" : "s"} today.`,
        };
      }
      case "summarize_week": {
        const data = await summarizeWeek(ctx);
        return {
          ok: true,
          data: data as unknown as Record<string, unknown>,
          message: `${data.counts.orders_this_week} order${data.counts.orders_this_week === 1 ? "" : "s"} this week.`,
        };
      }

      // ── Phase 6 — read-only gallery + sales optimization ──────────────
      case "review_gallery_coverage": {
        const schoolName = asString(input.params.school_name) ?? "";
        const result = await reviewGalleryCoverage(ctx, schoolName);
        if (!result.ok) {
          return { ok: false, status: result.status, message: result.message };
        }
        return {
          ok: true,
          data: result.data as unknown as Record<string, unknown>,
          message: result.message,
        };
      }
      case "highlight_popular_media": {
        const schoolName = asString(input.params.school_name) ?? "";
        const result = await highlightPopularMedia(ctx, schoolName);
        if (!result.ok) {
          return { ok: false, status: result.status, message: result.message };
        }
        return {
          ok: true,
          data: result.data as unknown as Record<string, unknown>,
          message: result.message,
        };
      }
      case "suggest_upsell_sizes": {
        const schoolName = asString(input.params.school_name);
        const result = await suggestUpsellSizes(ctx, schoolName);
        if (!result.ok) {
          return { ok: false, status: result.status, message: result.message };
        }
        return {
          ok: true,
          data: result.data as unknown as Record<string, unknown>,
          message: result.message,
        };
      }
      case "suggest_gallery_cover": {
        const schoolName = asString(input.params.school_name) ?? "";
        const result = await suggestGalleryCover(ctx, schoolName);
        if (!result.ok) {
          return { ok: false, status: result.status, message: result.message };
        }
        return {
          ok: true,
          data: result.data as unknown as Record<string, unknown>,
          message: result.message,
        };
      }

      default: {
        const exhaustive: never = input.intent;
        void exhaustive;
        return { ok: false, status: 422, message: "Unsupported intent." };
      }
    }
  } catch (err) {
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : "Unexpected executor error.",
    };
  }
}
