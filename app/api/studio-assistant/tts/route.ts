// POST /api/studio-assistant/tts
//
// Server-side proxy for ElevenLabs text-to-speech.  We never expose the
// API key to the browser; the client sends text + a voice id, the server
// authenticates the photographer, rate-limits the request length, and
// streams the audio bytes back.
//
// Behaviour when ELEVENLABS_API_KEY is missing: respond 501 with a clear
// message.  The client will then fall back to the browser's speech
// synthesis — voice just degrades, nothing breaks.

import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

// Protect the free tier — the assistant's spoken acks are short on purpose.
// We hard-cap at 400 characters server-side regardless of what the client sends.
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
        message:
          "Premium voice not configured. Set ELEVENLABS_API_KEY in .env.local to enable it.",
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
  const voiceId =
    typeof body.voice_id === "string" && body.voice_id.trim()
      ? body.voice_id.trim()
      : (process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"); // Adam by default

  // Authenticate — unauthenticated traffic shouldn't burn ElevenLabs quota.
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Please sign in again." },
      { status: 401 },
    );
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
      return NextResponse.json(
        {
          ok: false,
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
    return NextResponse.json(
      {
        ok: false,
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
