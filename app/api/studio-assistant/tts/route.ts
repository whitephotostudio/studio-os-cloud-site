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
// A service-only database transaction reserves each request's characters.
// Failed calls release only their own reservation, once, in the same period.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import { releaseVoiceUsage, reserveVoiceUsage, VoiceQuotaUnavailable } from "@/lib/voice-quota";

export const dynamic = "force-dynamic";

// Hard cap per single request — separate from the monthly per-user budget
// below.  Even an admin can't generate more than 400 chars in one shot.
const MAX_CHARS = 400;

type Body = {
  text?: string;
  voice_id?: string;
};

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
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body.");
    body = parsed as Body;
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

  // The database rechecks current admin/access/limit while holding the row
  // lock. A stale route-level SELECT must never authorize the paid request.
  const service = createDashboardServiceClient();
  const photographer = await getOrCreatePhotographerByUser(service, user);
  let quota: Awaited<ReturnType<typeof reserveVoiceUsage>>;
  try {
    quota = await reserveVoiceUsage(service, photographer.id, charCount);
  } catch {
    return NextResponse.json(
      { ok: false, code: "voice_accounting_unavailable", message: new VoiceQuotaUnavailable().message },
      { status: 503 },
    );
  }
  if (quota.status === "disabled") {
    return NextResponse.json({ ok: false, code: "voice_disabled",
      message: "Premium voice isn't enabled for your account. Contact your administrator to request access." }, { status: 403 });
  }
  if (quota.status === "limit") {
    return NextResponse.json({ ok: false, code: "voice_limit_reached",
      message: "You've reached your monthly premium voice limit. Browser voice will be used for the rest of the month.",
      used_this_month: quota.usedThisMonth, monthly_limit: quota.monthlyLimit }, { status: 429 });
  }
  const reservationId = quota.status === "reserved" ? quota.reservationId : null;

  const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let delivered = false;

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
    const response = new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
    delivered = true;
    return response;
  } catch (err) {
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
    if (!delivered && reservationId) {
      try { await releaseVoiceUsage(service, photographer.id, reservationId); }
      catch {
        // Keep the reservation charged if its release cannot be confirmed.
        // Never overwrite the counter or expose RPC/customer details in logs.
        console.error("[tts] Voice reservation release unavailable.");
      }
    }
  }
}
