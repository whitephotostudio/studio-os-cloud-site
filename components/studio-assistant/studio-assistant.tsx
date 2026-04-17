"use client";

// Studio Assistant — dashboard-level orchestrator.
// Composes the command bar, the right-side drawer, and the local voice
// settings into a single component the dashboard can drop into its header.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings2, Volume2, VolumeX } from "lucide-react";
import { parseAssistantCommand } from "@/lib/studio-assistant/mock-parser";
import { ParsedAssistantCommand } from "@/lib/studio-assistant/types";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  ELEVENLABS_VOICES,
  StudioAssistantSettings,
  consumeGreetingOnce,
  loadAssistantSettings,
  saveAssistantSettings,
} from "@/lib/studio-assistant/settings";
import {
  isSpeechSynthesisSupported,
  listSpeechVoices,
  speak,
  speakPremium,
} from "@/lib/studio-assistant/use-speech";
import {
  AssistantMemory,
  loadAssistantMemory,
  saveAssistantMemory,
  updateMemoryFromResult,
} from "@/lib/studio-assistant/session-memory";
import { useHydrated } from "@/lib/studio-assistant/use-hydrated";
import { shortSpokenAck } from "@/lib/studio-assistant/suggestions";
import { AssistantExecutionPlan } from "@/lib/studio-assistant/plan-types";
import { CommandBar, CommandBarExamples } from "./command-bar";
import { AssistantPanel, RunOutcome } from "./assistant-panel";
import { PlanPreview } from "./plan-preview";
import { createClient } from "@/lib/supabase/client";

const BORDER = "#e5e7eb";
const TEXT_MUTED = "#667085";

/* -------------------------------------------------------------------------- */
/*  Find-result navigation                                                    */
/* -------------------------------------------------------------------------- */

type FindNavigation = {
  /** Optional URL to navigate to (single, unambiguous match only). */
  href?: string;
  /** Override for the spoken acknowledgement. */
  spokenMessage?: string;
  /** Override for the message displayed in the result panel. */
  panelMessage?: string;
};

function asResultArray(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== "object") return [];
  const results = (data as Record<string, unknown>).results;
  return Array.isArray(results) ? (results as Array<Record<string, unknown>>) : [];
}

function schoolDisplayName(row: Record<string, unknown>): string {
  const name = row.school_name;
  return typeof name === "string" && name.trim() ? name.trim() : "this school";
}

function studentDisplayName(row: Record<string, unknown>): string {
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const full = [first, last].filter(Boolean).join(" ");
  return full || "this student";
}

/**
 * Decide whether a find result should auto-open a page and what to say out
 * loud. Single match → navigate. 2–3 matches → read the names aloud so the
 * user can pick verbally. Larger sets → return null and let the caller use
 * the default "Found N matching" voice line.
 */
function resolveFindNavigation(
  intent: string | null,
  data: unknown,
): FindNavigation | null {
  if (intent !== "find_school" && intent !== "find_student") return null;
  const rows = asResultArray(data);
  if (!rows.length) return null;

  if (intent === "find_school") {
    if (rows.length === 1) {
      const row = rows[0];
      const name = schoolDisplayName(row);
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) return null;
      return {
        href: `/dashboard/projects/schools/${id}`,
        spokenMessage: `Opening ${name}.`,
        panelMessage: `Opening ${name}…`,
      };
    }
    if (rows.length <= 3) {
      const names = rows.map(schoolDisplayName);
      const last = names.pop() as string;
      const phrase = names.length ? `${names.join(", ")} and ${last}` : last;
      return {
        spokenMessage: `I found ${rows.length} schools: ${phrase}. Which one?`,
      };
    }
    return null;
  }

  // find_student — students live inside schools, so we open the school page.
  if (rows.length === 1) {
    const row = rows[0];
    const name = studentDisplayName(row);
    const schoolId = typeof row.school_id === "string" ? row.school_id : null;
    if (!schoolId) {
      return { spokenMessage: `Found ${name}.` };
    }
    const school =
      typeof row.school_name === "string" && row.school_name.trim()
        ? ` at ${row.school_name.trim()}`
        : "";
    return {
      href: `/dashboard/projects/schools/${schoolId}`,
      spokenMessage: `Opening ${name}${school}.`,
      panelMessage: `Opening ${name}${school}…`,
    };
  }
  if (rows.length <= 3) {
    const names = rows.map(studentDisplayName);
    const last = names.pop() as string;
    const phrase = names.length ? `${names.join(", ")} and ${last}` : last;
    return {
      spokenMessage: `I found ${rows.length} students: ${phrase}. Which one?`,
    };
  }
  return null;
}

export type StudioAssistantProps = {
  /** Optional greeting text spoken/shown when the assistant first opens. */
  greetingName?: string | null;
};

export function StudioAssistant({ greetingName }: StudioAssistantProps) {
  const [settings, setSettings] = useState<StudioAssistantSettings>(
    DEFAULT_ASSISTANT_SETTINGS,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandValue, setCommandValue] = useState("");
  const [parsed, setParsed] = useState<ParsedAssistantCommand | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Phase 3 — session memory.  Kept as state so we can set it during a
  // render-phase hydration sync, with a ref mirror for use inside async
  // event handlers (fetches) without stale closures.
  const [memory, setMemory] = useState<AssistantMemory>({
    lastSchoolId: null,
    lastSchoolName: null,
    updatedAt: 0,
  });
  const memoryRef = useRef<AssistantMemory>(memory);
  useEffect(() => {
    memoryRef.current = memory;
  }, [memory]);
  // Phase 4 — multi-step plan state.
  const [plan, setPlan] = useState<AssistantExecutionPlan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planRunState, setPlanRunState] = useState<
    | { kind: "idle" }
    | { kind: "confirming" }
    | { kind: "running"; stepIndex: number }
    | { kind: "completed"; stoppedAt: number | null }
  >({ kind: "idle" });

  // Hydrate localStorage-backed settings + memory exactly once, AFTER
  // React has finished hydrating the server HTML.  `useHydrated()` is
  // false on the server and during the first client render, then flips to
  // true — so the server/client HTML always match, and we only read from
  // localStorage in a subsequent render (not a hydration render).
  const hydrated = useHydrated();
  const [hydratedSettings, setHydratedSettings] = useState(false);
  if (hydrated && !hydratedSettings) {
    setHydratedSettings(true);
    setSettings(loadAssistantSettings());
    setMemory(loadAssistantMemory());
  }

  // Speak helper — prefers ElevenLabs premium when toggled on, otherwise
  // uses the browser's speech synthesis.  Silently falls back if the
  // premium endpoint fails (no key, quota hit, network error).
  const smartSpeak = useCallback(
    async (phrase: string) => {
      if (settings.elevenLabsEnabled) {
        try {
          const supabase = createClient();
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const ok = await speakPremium(phrase, {
            enabled: true,
            voiceId: settings.elevenLabsVoiceId,
            authToken: session?.access_token ?? null,
          });
          if (ok) return;
        } catch {
          /* fall through to browser */
        }
      }
      speak(phrase, {
        enabled: true,
        rate: settings.voiceRate,
        pitch: settings.voicePitch,
        voiceURI: settings.voiceURI,
      });
    },
    [
      settings.elevenLabsEnabled,
      settings.elevenLabsVoiceId,
      settings.voiceRate,
      settings.voicePitch,
      settings.voiceURI,
    ],
  );

  // Play the once-per-session voice greeting after settings load.
  useEffect(() => {
    if (!settings.voiceGreetingEnabled) return;
    if (!isSpeechSynthesisSupported()) return;
    if (!consumeGreetingOnce()) return;
    const name = (greetingName ?? "").trim();
    const phrase = name
      ? `Welcome back, ${name}. Studio Assistant is ready.`
      : "Welcome back. Studio Assistant is ready.";
    void smartSpeak(phrase);
  }, [settings.voiceGreetingEnabled, greetingName, smartSpeak]);

  const updateSettings = useCallback(
    (patch: Partial<StudioAssistantSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveAssistantSettings(next);
        return next;
      });
    },
    [],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      // Show an immediate preview from the deterministic parser so the panel
      // isn't empty while the LLM route is thinking.
      const initial = parseAssistantCommand(text);
      setParsed(initial);
      setPanelOpen(true);

      // Phase 4: ask the server for a plan first.  If it returns 2+ steps
      // we open the multi-step plan preview.  Otherwise we fall back to the
      // single-step panel.  Network failures silently revert to the
      // deterministic single-step preview.
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        const planRes = await fetch("/api/studio-assistant/plan", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            command: text,
            contextHints: { lastSchoolName: memoryRef.current.lastSchoolName },
          }),
        });
        const planJson = (await planRes.json().catch(() => ({}))) as {
          ok?: boolean;
          plan?: AssistantExecutionPlan;
        };
        if (planRes.ok && planJson.ok && planJson.plan) {
          const serverPlan = planJson.plan;
          if (serverPlan.steps.length > 1) {
            setPlan(serverPlan);
            setPlanRunState({ kind: "idle" });
            setPanelOpen(false);
            setPlanOpen(true);
            return;
          }
        }

        // Fall back to single-step parse upgrade.
        const res = await fetch("/api/studio-assistant/parse", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            command: text,
            contextHints: {
              lastSchoolName: memoryRef.current.lastSchoolName,
            },
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          parsed?: ParsedAssistantCommand;
        };
        if (res.ok && json.ok && json.parsed) {
          setParsed(json.parsed);
        }
      } catch {
        /* parse upgrade failed — deterministic parse already visible */
      }

      if (settings.spokenAckEnabled) {
        const phrase = initial.intent
          ? `Previewing ${humanize(initial.intent)}.`
          : "I didn't quite catch that.";
        void smartSpeak(phrase);
      }
    },
    [settings.spokenAckEnabled, smartSpeak],
  );

  const handlePickExample = useCallback((example: string) => {
    setCommandValue(example);
  }, []);

  const handleEdit = useCallback((original: string) => {
    setCommandValue(original);
  }, []);

  // Memoize initial value so the command bar only resets when we truly
  // want it to (example click or "Edit" from the panel).
  const initialValue = useMemo(() => commandValue, [commandValue]);

  const voiceControlsLabel = useMemo(() => {
    const pieces: string[] = [];
    if (settings.voiceGreetingEnabled) pieces.push("greeting");
    if (settings.spokenAckEnabled) pieces.push("spoken reply");
    return pieces.length ? pieces.join(" · ") : "voice off";
  }, [settings]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <CommandBar
            onSubmit={handleSubmit}
            initialValue={initialValue}
            showMic={settings.micEnabled}
          />
          <CommandBarExamples onPick={handlePickExample} />
        </div>

        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          aria-label="Studio Assistant voice settings"
          title={`Voice settings — ${voiceControlsLabel}`}
          style={{
            flexShrink: 0,
            alignSelf: "flex-start",
            height: 66,
            minWidth: 66,
            padding: "0 16px",
            borderRadius: 20,
            border: `1px solid ${BORDER}`,
            background: "#fff",
            color: TEXT_MUTED,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 10px 30px rgba(17,24,39,0.04)",
          }}
        >
          <Settings2 size={16} />
          <span style={{ whiteSpace: "nowrap" }}>Voice</span>
        </button>
      </div>

      {settingsOpen ? (
        <SettingsPopover
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      <AssistantPanel
        open={panelOpen}
        parsed={parsed}
        onEdit={handleEdit}
        onSuggestedCommand={(command) => setCommandValue(command)}
        onRun={async (p): Promise<RunOutcome> => {
          // Phase 2: hit the secure run endpoint.  All writes are validated
          // and scoped to the signed-in photographer on the server.
          try {
            const supabase = createClient();
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };
            if (session?.access_token) {
              headers["Authorization"] = `Bearer ${session.access_token}`;
            }
            const res = await fetch("/api/studio-assistant/run", {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify({
                command: p.originalText,
                intent: p.intent,
                params: p.params,
                confirmed: true, // panel only calls onRun after confirmation
                contextHints: {
                  lastSchoolName: memoryRef.current.lastSchoolName,
                },
              }),
            });
            const json = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              message?: string;
              data?: Record<string, unknown>;
            };
            if (res.ok && json.ok) {
              // Update session memory from the server result so follow-ups
              // like "Set due date to June 1" can reuse the last school.
              const nextMemory = updateMemoryFromResult(
                memoryRef.current,
                json.data,
              );
              memoryRef.current = nextMemory;
              saveAssistantMemory(nextMemory);

              // Auto-navigate when a find returns exactly one obvious match.
              // For 2–3 matches, read the names aloud so the user can choose
              // without scanning the panel. Larger result sets fall through
              // to the default "Found N matching" message + clickable cards.
              const navigation = resolveFindNavigation(p.intent, json.data);
              const spokenMessage =
                navigation?.spokenMessage ??
                shortSpokenAck(p.intent, json.message ?? "Done.");

              if (settings.spokenAckEnabled) {
                void smartSpeak(spokenMessage);
              }

              const navHref = navigation?.href;
              if (navHref) {
                // Small delay so the spoken "Opening …" has a chance to start
                // before the page transition cuts the audio off.
                setTimeout(() => {
                  window.location.assign(navHref);
                }, 600);
              }

              return {
                ok: true,
                message: navigation?.panelMessage ?? json.message ?? "Action completed.",
                data: json.data,
              };
            }
            return {
              ok: false,
              message:
                json.message ??
                "Something went wrong. Please review the command and try again.",
            };
          } catch (err) {
            return {
              ok: false,
              message:
                err instanceof Error
                  ? err.message
                  : "Network error running assistant action.",
            };
          }
        }}
        onClose={() => setPanelOpen(false)}
      />

      <PlanPreview
        open={planOpen}
        plan={plan}
        runState={planRunState}
        onCancel={() => {
          setPlanOpen(false);
          setPlan(null);
          setPlanRunState({ kind: "idle" });
        }}
        onClose={() => {
          if (planRunState.kind === "running") return; // don't abort mid-run
          setPlanOpen(false);
        }}
        onRun={async () => {
          if (!plan) return;

          // Two-step confirmation for write-containing plans.
          if (plan.requiresConfirmation && planRunState.kind !== "confirming") {
            setPlanRunState({ kind: "confirming" });
            return;
          }

          setPlanRunState({ kind: "running", stepIndex: 0 });
          try {
            const supabase = createClient();
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };
            if (session?.access_token) {
              headers["Authorization"] = `Bearer ${session.access_token}`;
            }
            const res = await fetch("/api/studio-assistant/plan/run", {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify({
                command: plan.originalPrompt,
                plan,
                confirmed: true,
                contextHints: {
                  lastSchoolName: memoryRef.current.lastSchoolName,
                },
              }),
            });
            const json = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              message?: string;
              stoppedAt?: number | null;
              plan?: AssistantExecutionPlan;
            };
            if (json.plan) {
              setPlan(json.plan);
              // Update session memory from the last successful step's data.
              for (const step of json.plan.steps) {
                if (step.status === "completed" && step.result?.data) {
                  const next = updateMemoryFromResult(
                    memoryRef.current,
                    step.result.data,
                  );
                  memoryRef.current = next;
                  saveAssistantMemory(next);
                }
              }
            }
            setPlanRunState({
              kind: "completed",
              stoppedAt: typeof json.stoppedAt === "number" ? json.stoppedAt : null,
            });
            if (settings.spokenAckEnabled) {
              void smartSpeak(json.ok ? "Plan complete." : "Plan stopped early.");
            }
          } catch {
            setPlanRunState({ kind: "completed", stoppedAt: 0 });
          }
        }}
      />
    </div>
  );
}

function humanize(intent: string): string {
  return intent.replace(/_/g, " ");
}

/* -------------------------------------------------------------------------- */
/*  Settings popover                                                          */
/* -------------------------------------------------------------------------- */

function SettingsPopover({
  settings,
  onChange,
  onClose,
}: {
  settings: StudioAssistantSettings;
  onChange: (patch: Partial<StudioAssistantSettings>) => void;
  onClose: () => void;
}) {
  const synthesisSupported = isSpeechSynthesisSupported();
  const [voices, setVoices] = useState(() => listSpeechVoices());

  useEffect(() => {
    if (!synthesisSupported) return;
    const refresh = () => setVoices(listSpeechVoices());
    refresh();
    window.speechSynthesis?.addEventListener?.("voiceschanged", refresh);
    return () => {
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refresh);
    };
  }, [synthesisSupported]);

  return (
    <div
      style={{
        marginTop: 12,
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 18,
        boxShadow: "0 20px 50px rgba(17,24,39,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 520,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", display: "flex", alignItems: "center", gap: 8 }}>
          {synthesisSupported ? <Volume2 size={15} /> : <VolumeX size={15} />}
          Voice preferences
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </div>

      <Toggle
        label="Voice greeting on open"
        description="Speak a short hello once per browser session."
        checked={settings.voiceGreetingEnabled}
        disabled={!synthesisSupported}
        onChange={(v) => onChange({ voiceGreetingEnabled: v })}
      />
      <Toggle
        label="Spoken acknowledgment"
        description="Say the interpreted intent after each command."
        checked={settings.spokenAckEnabled}
        disabled={!synthesisSupported}
        onChange={(v) => onChange({ spokenAckEnabled: v })}
      />
      <Toggle
        label="Show microphone button"
        description="Turn off if you prefer typing commands only."
        checked={settings.micEnabled}
        onChange={(v) => onChange({ micEnabled: v })}
      />

      {synthesisSupported ? (
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            paddingTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <SliderRow
            label="Speaking rate"
            value={settings.voiceRate}
            min={0.7}
            max={1.3}
            step={0.05}
            onChange={(v) => onChange({ voiceRate: v })}
          />
          <SliderRow
            label="Pitch"
            value={settings.voicePitch}
            min={0.6}
            max={1.4}
            step={0.05}
            onChange={(v) => onChange({ voicePitch: v })}
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
              Voice
            </div>
            <select
              value={settings.voiceURI ?? ""}
              onChange={(e) => onChange({ voiceURI: e.target.value || null })}
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: "#111827",
                fontSize: 13,
                // Defend against Safari dark-mode auto-colouring the native
                // select text to white against our forced white background.
                colorScheme: "light",
                appearance: "none",
                WebkitAppearance: "none",
              }}
            >
              <option value="" style={{ color: "#111827" }}>
                Browser default
              </option>
              {voices.map((v) => (
                <option
                  key={v.voiceURI}
                  value={v.voiceURI}
                  style={{ color: "#111827" }}
                >
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {!synthesisSupported ? (
        <div
          style={{
            fontSize: 12,
            color: TEXT_MUTED,
            background: "#f7f7f8",
            borderRadius: 12,
            padding: "8px 10px",
          }}
        >
          Voice output isn&rsquo;t available in this browser. Studio Assistant will
          fall back to text-only.
        </div>
      ) : null}

      <div
        style={{
          borderTop: `1px solid ${BORDER}`,
          paddingTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <Toggle
          label="Premium AI voice (ElevenLabs)"
          description="Route spoken replies through ElevenLabs for a natural, cinematic voice. Falls back to browser voice if not configured."
          checked={settings.elevenLabsEnabled}
          onChange={(v) => onChange({ elevenLabsEnabled: v })}
        />
        {settings.elevenLabsEnabled ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
              Premium voice
            </div>
            <select
              value={settings.elevenLabsVoiceId ?? ""}
              onChange={(e) => onChange({ elevenLabsVoiceId: e.target.value || null })}
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: "#111827",
                fontSize: 13,
                colorScheme: "light",
                appearance: "none",
                WebkitAppearance: "none",
              }}
            >
              <option value="" style={{ color: "#111827" }}>
                Server default (Adam)
              </option>
              {ELEVENLABS_VOICES.map((v) => (
                <option
                  key={v.id}
                  value={v.id}
                  style={{ color: "#111827" }}
                >
                  {v.name} — {v.description}
                </option>
              ))}
            </select>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: TEXT_MUTED,
                lineHeight: 1.5,
              }}
            >
              Premium voice is included with eligible Studio plans. If you
              hear the browser voice instead, your monthly premium-voice
              budget may be paused — your administrator can adjust it.
            </div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          borderTop: `1px solid ${BORDER}`,
          paddingTop: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
          color: TEXT_MUTED,
        }}
      >
        <span>Debug &amp; audit</span>
        <a
          href="/dashboard/studio-assistant/debug"
          style={{
            color: "#0f172a",
            fontWeight: 700,
            textDecoration: "none",
            padding: "6px 10px",
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
            background: "#fff",
          }}
        >
          View activity log →
        </a>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{label}</span>
        <span style={{ fontSize: 12, color: TEXT_MUTED, fontVariantNumeric: "tabular-nums" }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span>
        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#111827" }}>
          {label}
        </span>
        <span style={{ display: "block", fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>
          {description}
        </span>
      </span>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
        style={{
          width: 40,
          height: 22,
          borderRadius: 99,
          background: checked ? "#0f172a" : "#e5e7eb",
          position: "relative",
          transition: "background 0.15s ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 20 : 2,
            width: 18,
            height: 18,
            borderRadius: 99,
            background: "#fff",
            boxShadow: "0 1px 2px rgba(15,23,42,0.2)",
            transition: "left 0.15s ease",
          }}
        />
      </span>
    </label>
  );
}
