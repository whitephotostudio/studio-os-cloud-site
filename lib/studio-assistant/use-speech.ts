"use client";

// Studio Assistant — thin wrappers around browser SpeechRecognition and
// SpeechSynthesis.  Both APIs are optional; the hook returns a `supported`
// flag so the UI can render a text-only fallback instead of crashing in
// Safari/Firefox without speech support.

import { useCallback, useEffect, useRef, useState } from "react";
import { useHydrated } from "./use-hydrated";

/* -------------------------------------------------------------------------- */
/*  Recognition                                                               */
/* -------------------------------------------------------------------------- */

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    0: { transcript: string };
    isFinal: boolean;
  }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type UseSpeechRecognitionResult = {
  supported: boolean;
  listening: boolean;
  transcript: string;
  start: () => void;
  stop: () => void;
  reset: () => void;
  error: string | null;
};

export function useSpeechRecognition(options?: {
  onFinalTranscript?: (text: string) => void;
}): UseSpeechRecognitionResult {
  // We must render identical HTML on the server AND during the client's
  // first render (pre-hydration).  `useHydrated` returns false until the
  // first paint is committed, so the mic button renders as "unsupported"
  // during hydration and then upgrades to its real state — with no
  // hydration mismatch warning.
  const hydrated = useHydrated();
  const supported = hydrated && getRecognitionCtor() !== null;

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(options?.onFinalTranscript);

  // Keep the latest callback without re-initializing recognition each render.
  useEffect(() => {
    callbackRef.current = options?.onFinalTranscript;
  }, [options?.onFinalTranscript]);

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (!r) continue;
        const piece = r[0]?.transcript ?? "";
        if (r.isFinal) {
          finalText += piece;
        } else {
          interim += piece;
        }
      }
      setTranscript(finalText || interim);
      if (finalText && callbackRef.current) {
        callbackRef.current(finalText.trim());
      }
    };

    rec.onerror = (evt: unknown) => {
      const errEvt = evt as { error?: string } | undefined;
      setError(errEvt?.error ?? "speech-error");
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;

    return () => {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort?.();
      } catch {
        /* no-op */
      }
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    setError(null);
    setTranscript("");
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "speech-start-failed");
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* no-op */
    }
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  return { supported, listening, transcript, start, stop, reset, error };
}

/* -------------------------------------------------------------------------- */
/*  Synthesis                                                                 */
/* -------------------------------------------------------------------------- */

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export type VoicePrefs = {
  enabled?: boolean;
  rate?: number; // 0.1..10 (typical 0.9–1.1)
  pitch?: number; // 0..2
  volume?: number; // 0..1
  voiceURI?: string | null; // selected voice URI
};

/**
 * Return the list of installed voices, preferring English ones up front.
 * Safe to call before the voices list has loaded — returns []
 * in that case.  Hook into 'voiceschanged' to refresh.
 */
export function listSpeechVoices(): Array<{
  name: string;
  lang: string;
  voiceURI: string;
  default: boolean;
}> {
  if (!isSpeechSynthesisSupported()) return [];
  try {
    const voices = window.speechSynthesis.getVoices();
    const mapped = voices.map((v) => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      default: v.default,
    }));
    // Sort English voices first, then by name.
    mapped.sort((a, b) => {
      const aEn = a.lang.toLowerCase().startsWith("en") ? 0 : 1;
      const bEn = b.lang.toLowerCase().startsWith("en") ? 0 : 1;
      if (aEn !== bEn) return aEn - bEn;
      return a.name.localeCompare(b.name);
    });
    return mapped;
  } catch {
    return [];
  }
}

/** Track which phrases we've just spoken to avoid duplicate acknowledgments. */
let __lastPhrase = "";
let __lastPhraseAt = 0;

/** Speak a short phrase.  Silent no-op if synthesis isn't available. */
export function speak(text: string, opts?: VoicePrefs): void {
  if (opts?.enabled === false) return;
  if (!isSpeechSynthesisSupported()) return;

  const phrase = shortenPhrase(text);
  const now = Date.now();
  // Don't repeat the exact same phrase within 4s — prevents voice
  // feedback loops and echoed confirmations.
  if (phrase === __lastPhrase && now - __lastPhraseAt < 4_000) return;
  __lastPhrase = phrase;
  __lastPhraseAt = now;

  try {
    const utter = new SpeechSynthesisUtterance(phrase);
    utter.rate = clamp(opts?.rate ?? 1, 0.5, 1.6);
    utter.pitch = clamp(opts?.pitch ?? 1, 0, 2);
    utter.volume = clamp(opts?.volume ?? 1, 0, 1);

    if (opts?.voiceURI) {
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.voiceURI === opts.voiceURI);
      if (match) utter.voice = match;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch {
    /* best-effort voice — never throw */
  }
}

/**
 * Trim a phrase to a short, confident one-liner so the voice never drones
 * on.  Splits on sentence boundaries and keeps just the first.
 */
function shortenPhrase(text: string): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= 120) return s;
  const firstSentence = s.split(/(?<=[.!?])\s+/)[0] ?? s;
  return firstSentence.slice(0, 120);
}

/* -------------------------------------------------------------------------- */
/*  Premium speak (ElevenLabs)                                                */
/* -------------------------------------------------------------------------- */

/** Tracks the currently-playing premium audio so we can replace it cleanly. */
let __premiumAudio: HTMLAudioElement | null = null;

export type PremiumSpeakOptions = {
  enabled?: boolean;
  voiceId?: string | null;
  /** Bearer access token for the dashboard route. */
  authToken?: string | null;
};

/**
 * Speak a phrase via the server-side ElevenLabs proxy.  Returns `true` if
 * audio was successfully played, `false` if anything went wrong — the
 * caller can then fall back to the browser TTS.
 */
export async function speakPremium(
  text: string,
  opts: PremiumSpeakOptions = {},
): Promise<boolean> {
  if (opts.enabled === false) return false;
  if (typeof window === "undefined") return false;

  const phrase = shortenPhrase(text);
  const now = Date.now();
  if (phrase === __lastPhrase && now - __lastPhraseAt < 4_000) return true;
  __lastPhrase = phrase;
  __lastPhraseAt = now;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.authToken) {
      headers["Authorization"] = `Bearer ${opts.authToken}`;
    }
    const res = await fetch("/api/studio-assistant/tts", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        text: phrase,
        voice_id: opts.voiceId ?? undefined,
      }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Replace any currently-playing premium audio.
    try {
      __premiumAudio?.pause();
    } catch {
      /* no-op */
    }
    const audio = new Audio(url);
    __premiumAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (__premiumAudio === audio) __premiumAudio = null;
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (__premiumAudio === audio) __premiumAudio = null;
    };
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
