// POST /api/studio-assistant/tts
//
// Server-side proxy for ElevenLabs text-to-speech.  We never expose the
// API key to the browser; the client sends text + a voice id, the server
// authenticates the photographer, enforces admin-controlled per-user
// monthly character budgets, and streams the audio bytes back.
//
// Access control:
//   - Platform admins (is_platform_admin = true)        → unlimited
//   - Photographers with voice_premium_enabled = false  → 403, browser falls back
//   - Photographers above their voice_monthly_char_limit → 429, browser falls back
//
// On any non-admin success we increment voice_chars_used_this_month by the
// final character count.  When voice_usage_period_start rolls into a new
// calendar month we reset the counter before incrementing.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";

export const dynamic = "force-dynamic";

// Hard cap per single request — separate from the monthly per-user budget
// below.  Even an admin can't generate more than 400 chars in one shot.
const MAX_CHARS = 400;

type Body = {
  text?: string;
  voice_id?: string;
};

/** Returns true when `since` falls in a different calendar month than now. */
function isNewMonth(since: Date, now: Date): boolean {
  return (
    since.getUTCFullYear() !== now.getUTCFullYear() ||
    since.getUTCMonth() !== now.getUTCMonth()
  );
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        code: "not_configured",
        message: "Premium voice is not configured.",
      },
      { status: 501 },
    );
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json(
      { ok: false, message: "Missing text." },
      { status: 400 },
    );
  }
  const trimmed = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  const charCount = trimmed.length;

  const voiceId =
    typeof body.voice_id === "string" && body.voice_id.trim()
      ? body.voice_id.trim()
      : (process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"); // Adam by default

  // Authenticate — unauthenticated traffic shouldn't burn ElevenLabs quota.
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "unauthenticated", message: "Please sign in again." },
      { status: 401 },
    );
  }

  // Resolve the photographer record so we can check + update voice quota.
  const service = createDashboardServiceClient();
  const photographer = await getOrCreatePhotographerByUser(service, user);

  // Refresh the row with the voice columns (the helper above doesn't return them).
  const { data: voiceRow, error: voiceErr } = await service
    .from("photographers")
    .select(
      "id,is_platform_admin,voice_premium_enabled,voice_monthly_char_limit,voice_chars_used_this_month,voice_usage_period_start",
    )
    .eq("id", photographer.id)
    .maybeSingle();

  if (voiceErr || !voiceRow) {
    return NextResponse.json(
      {
        ok: false,
        code: "lookup_failed",
        message: "Could not load voice settings.",
      },
      { status: 500 },
    );
  }

  const isAdmin = Boolean(voiceRow.is_platform_admin);

  if (!isAdmin) {
    if (!voiceRow.voice_premium_enabled) {
      return NextResponse.json(
        {
          ok: false,
          code: "voice_disabled",
          message:
            "Premium voice isn't enabled for your account. Contact your administrator to request access.",
        },
        { status: 403 },
      );
    }

    // Roll the monthly window if we've crossed a calendar month.
    const periodStart = voiceRow.voice_usage_period_start
      ? new Date(voiceRow.voice_usage_period_start as string)
      : new Date();
    const now = new Date();
    let usedThisMonth = Number(voiceRow.voice_chars_used_this_month ?? 0);
    let periodStartIso: string | null = null;
    if (isNewMonth(periodStart, now)) {
      usedThisMonth = 0;
      periodStartIso = now.toISOString();
    }

    const limit = Number(voiceRow.voice_monthly_char_limit ?? 0);
    if (limit <= 0 || usedThisMonth + charCount > limit) {
      return NextResponse.json(
        {
          ok: false,
          code: "voice_limit_reached",
          message:
            "You've reached your monthly premium voice limit. Browser voice will be used for the rest of the month.",
          used_this_month: usedThisMonth,
          monthly_limit: limit,
        },
        { status: 429 },
      );
    }

    // Optimistically reserve the budget so two parallel requests don't both
    // squeak through.  If the upstream call fails we'll roll the counter back.
    const reservedUsage = usedThisMonth + charCount;
    const updatePayload: Record<string, unknown> = {
      voice_chars_used_this_month: reservedUsage,
    };
    if (periodStartIso) updatePayload.voice_usage_period_start = periodStartIso;
    await service
      .from("photographers")
      .update(updatePayload)
      .eq("id", photographer.id);
  }

  const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: trimmed,
          model_id: modelId,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      // Roll back the optimistic usage we charged for non-admins.
      if (!isAdmin) {
        await service
          .from("photographers")
          .update({
            voice_chars_used_this_month: Math.max(
              0,
              Number(voiceRow.voice_chars_used_this_month ?? 0),
            ),
          })
          .eq("id", photographer.id);
      }
      return NextResponse.json(
        {
          ok: false,
          code: "upstream_error",
          message: `ElevenLabs error ${upstream.status}: ${errText.slice(0, 200)}`,
        },
        { status: upstream.status === 401 || upstream.status === 403 ? 502 : 500 },
      );
    }

    const audio = await upstream.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Roll back the optimistic usage on network failures too.
    if (!isAdmin) {
      await service
        .from("photographers")
        .update({
          voice_chars_used_this_month: Math.max(
            0,
            Number(voiceRow.voice_chars_used_this_month ?? 0),
          ),
        })
        .eq("id", photographer.id);
    }
    return NextResponse.json(
      {
        ok: false,
        code: "network_error",
        message:
          err instanceof Error
            ? err.name === "AbortError"
              ? "Premium voice timed out."
              : err.message
            : "Premium voice failed.",
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
