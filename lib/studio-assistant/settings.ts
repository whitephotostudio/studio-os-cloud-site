// Studio Assistant — local-only voice settings (Phase 1).
// Persisted in localStorage per-browser.  Server-side settings come in Phase 2.

export type StudioAssistantSettings = {
  /** Speak a short greeting when the panel first opens in a session. */
  voiceGreetingEnabled: boolean;
  /** Speak a short acknowledgment after a command is parsed. */
  spokenAckEnabled: boolean;
  /** Whether the mic button is shown at all. */
  micEnabled: boolean;
  /** Speech rate 0.5–1.6 (browser TTS only; ElevenLabs ignores this). */
  voiceRate: number;
  /** Speech pitch 0–2 (browser TTS only). */
  voicePitch: number;
  /** Selected browser voice URI (null = browser default). */
  voiceURI: string | null;
  /** Use the premium ElevenLabs voice route for spoken replies. */
  elevenLabsEnabled: boolean;
  /** Which ElevenLabs voice to use (null = server default). */
  elevenLabsVoiceId: string | null;
};

export const DEFAULT_ASSISTANT_SETTINGS: StudioAssistantSettings = {
  voiceGreetingEnabled: false,
  spokenAckEnabled: false,
  micEnabled: true,
  voiceRate: 1,
  voicePitch: 1,
  voiceURI: null,
  elevenLabsEnabled: false,
  elevenLabsVoiceId: null,
};

/** Curated list of ElevenLabs default voices with short descriptions. */
export const ELEVENLABS_VOICES: Array<{
  id: string;
  name: string;
  description: string;
}> = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Male · deep, authoritative (Jarvis-tier)" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", description: "Male · deep, thoughtful" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", description: "Male · crisp, confident" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "Male · warm, well-rounded" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "Female · calm, narrator" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Female · soft, friendly" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", description: "Female · strong, commanding" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", description: "Female · young, expressive" },
];

const SETTINGS_KEY = "studio-assistant:settings:v1";
const GREETING_SESSION_KEY = "studio-assistant:greeting-played";

export function loadAssistantSettings(): StudioAssistantSettings {
  if (typeof window === "undefined") return DEFAULT_ASSISTANT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_ASSISTANT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioAssistantSettings>;
    return { ...DEFAULT_ASSISTANT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_ASSISTANT_SETTINGS;
  }
}

export function saveAssistantSettings(
  next: StudioAssistantSettings,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage quota or locked-down environment — best effort only */
  }
}

/** True once per sessionStorage — avoids re-greeting on every panel open. */
export function consumeGreetingOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(GREETING_SESSION_KEY) === "1") {
      return false;
    }
    window.sessionStorage.setItem(GREETING_SESSION_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
