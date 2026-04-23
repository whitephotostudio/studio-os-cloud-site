"use client";

// Studio Assistant — premium command bar with inline mic button.
// Desktop-first but fluid enough to adapt to narrower widths later.

import { useRef, useState } from "react";
import { ChevronDown, Mic, MicOff, Send, Sparkles } from "lucide-react";
import {
  useSpeechRecognition,
} from "@/lib/studio-assistant/use-speech";

export type CommandBarProps = {
  /** Called when the user presses Enter or clicks the submit button. */
  onSubmit: (text: string) => void;
  /** Initial text; useful when the panel pre-populates edits. */
  initialValue?: string;
  /** Hide the mic button entirely (respects user settings). */
  showMic?: boolean;
  /** Optional placeholder override. */
  placeholder?: string;
};

/**
 * Pre-written commands grouped by theme. Picking one fills the command
 * bar so the user can hit "Ask" immediately. This replaces the earlier
 * chip strip and gives the user a scannable menu of what Studio
 * Assistant can do.
 */
const COMMAND_GROUPS: Array<{ label: string; items: string[] }> = [
  {
    label: "Today's overview",
    items: [
      "What needs my attention?",
      "Show today's summary",
      "Show this week's summary",
    ],
  },
  {
    label: "Orders & revenue",
    items: [
      "Which digital orders are still pending?",
      "Show order backlog",
      "Show sales by school this month",
      "Which package profiles perform best this month?",
    ],
  },
  {
    label: "Schools & releases",
    items: [
      "Which schools are not ready for release?",
      "Which galleries expire this week?",
      "Show unreleased schools with parent interest",
    ],
  },
  {
    label: "Gallery optimization",
    items: [
      "Review gallery coverage",
      "Show the most popular images",
      "Suggest upsell sizes",
    ],
  },
];

const ALL_COMMANDS = COMMAND_GROUPS.flatMap((g) => g.items);

const BORDER = "#e5e7eb";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#667085";
const ACCENT = "#cc0000";

export function CommandBar({
  onSubmit,
  initialValue = "",
  showMic = true,
  placeholder = "Ask Studio OS to create, update, release, or organize…",
}: CommandBarProps) {
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Render-phase sync for the controlled initialValue prop.  Avoids the
  // React 19 set-state-in-effect rule and the extra render that useEffect
  // would cause.
  const [prevInitialValue, setPrevInitialValue] = useState(initialValue);
  if (initialValue !== prevInitialValue) {
    setPrevInitialValue(initialValue);
    setValue(initialValue);
  }

  const speech = useSpeechRecognition({
    onFinalTranscript: (text) => {
      // When voice input is used, we append any interim text the user might
      // have typed AND auto-submit — so the photographer never has to touch
      // the keyboard after speaking.  Typed input still requires Enter.
      setValue((prev) => {
        const combined = prev ? `${prev} ${text}`.trim() : text;
        const toSubmit = combined.trim();
        if (toSubmit) {
          // Defer to the next tick so React has time to flush the value
          // into the controlled input before the host opens the panel.
          window.setTimeout(() => onSubmit(toSubmit), 0);
        }
        return combined;
      });
    },
  });

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  function toggleMic() {
    if (!speech.supported) return;
    if (speech.listening) speech.stop();
    else speech.start();
  }

  const canSubmit = value.trim().length > 0;

  return (
    <div
      role="group"
      aria-label="Studio Assistant command bar"
      style={{
        background: "#ffffff",
        border: `1px solid ${focused ? ACCENT : BORDER}`,
        borderRadius: 20,
        padding: "10px 14px 10px 18px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: focused
          ? "0 14px 40px rgba(204,0,0,0.10)"
          : "0 10px 30px rgba(17,24,39,0.04)",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          background: "#fff5f5",
          color: ACCENT,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Sparkles size={16} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <label
          htmlFor="studio-assistant-input"
          style={{
            display: "block",
            fontSize: 11,
            letterSpacing: "0.12em",
            fontWeight: 800,
            color: TEXT_MUTED,
            marginBottom: 2,
          }}
        >
          STUDIO ASSISTANT
        </label>
        <input
          id="studio-assistant-input"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Studio Assistant command"
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            color: TEXT_PRIMARY,
            fontSize: 15,
            fontWeight: 600,
            padding: "2px 0",
          }}
        />
      </div>

      {showMic ? (
        <button
          type="button"
          onClick={toggleMic}
          disabled={!speech.supported}
          title={
            speech.supported
              ? speech.listening
                ? "Stop listening"
                : "Start voice command"
              : "Voice input not supported in this browser"
          }
          aria-pressed={speech.listening}
          aria-label={
            speech.listening ? "Stop voice input" : "Start voice input"
          }
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            border: `1px solid ${speech.listening ? ACCENT : BORDER}`,
            background: speech.listening ? "#fff0f0" : "#fff",
            color: speech.supported
              ? speech.listening
                ? ACCENT
                : TEXT_MUTED
              : "#c8c8c8",
            cursor: speech.supported ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "border-color 0.15s ease, background 0.15s ease",
          }}
        >
          {speech.supported ? (
            speech.listening ? (
              <Mic size={17} />
            ) : (
              <Mic size={17} />
            )
          ) : (
            <MicOff size={17} />
          )}
        </button>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        aria-label="Submit command"
        style={{
          height: 40,
          padding: "0 16px",
          borderRadius: 12,
          border: "none",
          background: canSubmit ? "#0f172a" : "#e5e7eb",
          color: canSubmit ? "#fff" : "#94a3b8",
          fontWeight: 800,
          fontSize: 13,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          cursor: canSubmit ? "pointer" : "not-allowed",
          flexShrink: 0,
          transition: "background 0.15s ease",
        }}
      >
        <Send size={14} /> Ask
      </button>
    </div>
  );
}

/**
 * Dropdown of pre-written commands grouped by theme. When the user
 * picks one we call `onPick` with the text so the parent can drop it
 * into the command bar. The parent decides whether to auto-submit or
 * let the user confirm with the "Ask" button.
 *
 * Kept as a native <select> so it works on every browser without a
 * custom popover, and because the user explicitly asked for a dropdown.
 */
export function CommandBarExamples({
  onPick,
}: {
  onPick: (example: string) => void;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <label
        htmlFor="studio-assistant-command-picker"
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          fontWeight: 800,
          color: TEXT_MUTED,
        }}
      >
        QUICK COMMAND
      </label>

      <div
        style={{
          position: "relative",
          flex: "1 1 260px",
          maxWidth: 520,
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <select
          id="studio-assistant-command-picker"
          // Use key=value so picking the same option twice still fires a change.
          // We reset to empty via the `key` below to keep the placeholder.
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) {
              onPick(v);
              // Reset so picking the same prompt again re-triggers the fill.
              e.target.value = "";
            }
          }}
          aria-label="Choose a pre-written command"
          style={{
            width: "100%",
            appearance: "none",
            WebkitAppearance: "none",
            background: "#fff",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "10px 36px 10px 14px",
            fontSize: 13,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            cursor: "pointer",
            // Force light-mode rendering so Safari doesn't paint the
            // open dropdown with dark system chrome.
            colorScheme: "light",
          }}
        >
          {/*
            Inline `color` + `background` on every <option>/<optgroup> is
            deliberate: Safari (and some Chromium builds) ignore the parent
            select's `color` / `colorScheme` when painting the native
            popup, producing the washed-out grey-on-grey look Harout flagged.
            Explicit per-option styling guarantees readable text.
          */}
          <option
            value=""
            disabled
            style={{ color: TEXT_MUTED, background: "#fff" }}
          >
            Choose a prompt…
          </option>
          {COMMAND_GROUPS.map((group) => (
            <optgroup
              key={group.label}
              label={group.label}
              style={{
                color: TEXT_PRIMARY,
                background: "#f7f7f8",
                fontWeight: 800,
              }}
            >
              {group.items.map((item) => (
                <option
                  key={item}
                  value={item}
                  style={{ color: TEXT_PRIMARY, background: "#fff" }}
                >
                  {item}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown
          size={15}
          color={TEXT_MUTED}
          style={{
            position: "absolute",
            right: 12,
            pointerEvents: "none",
          }}
        />
      </div>

      <span style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700 }}>
        {ALL_COMMANDS.length} ready-to-go prompts · pick one, then Ask
      </span>
    </div>
  );
}
