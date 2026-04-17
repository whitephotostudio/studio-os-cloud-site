"use client";

// Studio Assistant — right-side drawer that previews a parsed command.
// Phase 2: `Run` now calls the caller's onRun handler (which talks to the
// secure /api/studio-assistant/run endpoint) and surfaces real server
// results or errors in the banner.

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Edit3,
  Loader2,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import {
  ParsedAssistantCommand,
  intentLabel,
  isWriteIntent,
} from "@/lib/studio-assistant/types";
import {
  AssistantSuggestion,
  suggestionsForIntent,
} from "@/lib/studio-assistant/suggestions";

export type RunOutcome =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; message: string };

const BORDER = "#e5e7eb";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#667085";
const ACCENT = "#cc0000";
const SURFACE = "#ffffff";

export type AssistantPanelProps = {
  open: boolean;
  parsed: ParsedAssistantCommand | null;
  /**
   * Called when the user presses Run.  The panel awaits the returned
   * promise and surfaces its success / error state in the banner.
   */
  onRun?: (parsed: ParsedAssistantCommand) => Promise<RunOutcome> | void;
  /** Panel asks the host to re-open the command bar pre-filled with text. */
  onEdit?: (originalText: string) => void;
  /** Host wants to pre-fill the command bar with a suggested follow-up. */
  onSuggestedCommand?: (command: string) => void;
  onClose: () => void;
};

type RunState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "running" }
  | {
      kind: "success";
      message: string;
      data?: Record<string, unknown>;
    }
  | { kind: "error"; message: string }
  | { kind: "blocked"; reason: string };

export function AssistantPanel({
  open,
  parsed,
  onRun,
  onEdit,
  onSuggestedCommand,
  onClose,
}: AssistantPanelProps) {
  const [runState, setRunState] = useState<RunState>({ kind: "idle" });

  // Reset state whenever a new parsed command arrives.  Render-phase sync
  // (not useEffect) so it doesn't trigger the set-state-in-effect rule and
  // avoids a cascading extra render.
  const parsedKey = parsed
    ? `${parsed.originalText}::${parsed.intent ?? ""}`
    : null;
  const [prevParsedKey, setPrevParsedKey] = useState<string | null>(parsedKey);
  if (parsedKey !== prevParsedKey) {
    setPrevParsedKey(parsedKey);
    setRunState({ kind: "idle" });
  }

  if (!open) return null;

  const requiresConfirmation = parsed ? parsed.requiresConfirmation : false;
  const isWrite = isWriteIntent(parsed?.intent ?? null);

  function handleRunClick() {
    if (!parsed) return;
    if (!parsed.intent) {
      setRunState({
        kind: "blocked",
        reason: "No supported intent was detected. Edit the command and try again.",
      });
      return;
    }
    if (requiresConfirmation && runState.kind !== "confirming") {
      setRunState({ kind: "confirming" });
      return;
    }
    void runReal();
  }

  async function runReal() {
    if (!parsed) return;
    setRunState({ kind: "running" });
    try {
      const maybe = onRun?.(parsed);
      // Support both sync (void) and async (Promise<RunOutcome>) onRun.
      const outcome = (await Promise.resolve(maybe)) as RunOutcome | undefined;
      if (!outcome) {
        setRunState({
          kind: "success",
          message: "Ready for backend wiring.",
        });
        return;
      }
      if (outcome.ok) {
        setRunState({
          kind: "success",
          message: outcome.message,
          data: outcome.data,
        });
      } else {
        setRunState({ kind: "error", message: outcome.message });
      }
    } catch (err) {
      setRunState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.32)",
          zIndex: 90,
          animation: "studio-assistant-fade 160ms ease",
        }}
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Studio Assistant"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(460px, 100%)",
          background: SURFACE,
          borderLeft: `1px solid ${BORDER}`,
          boxShadow: "-24px 0 60px rgba(15,23,42,0.16)",
          zIndex: 91,
          display: "flex",
          flexDirection: "column",
          animation: "studio-assistant-slide 220ms ease",
        }}
      >
        <header
          style={{
            padding: "22px 22px 18px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div
              aria-hidden
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: "#fff5f5",
                color: ACCENT,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={17} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  fontWeight: 800,
                  color: TEXT_MUTED,
                }}
              >
                STUDIO ASSISTANT
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 900,
                  color: TEXT_PRIMARY,
                }}
              >
                Command preview
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 4,
              marginTop: 2,
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: 22, flex: 1, overflowY: "auto" }}>
          {parsed ? (
            <PanelBody
              parsed={parsed}
              runState={runState}
              isWrite={isWrite}
              onSuggestedCommand={(text) => {
                onSuggestedCommand?.(text);
                onClose();
              }}
            />
          ) : (
            <div style={{ color: TEXT_MUTED, fontSize: 14 }}>
              Type a command in the bar to see what Studio Assistant will do.
            </div>
          )}
        </div>

        <footer
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: "14px 22px",
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexWrap: "wrap",
            background: "#fafafa",
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (parsed && onEdit) onEdit(parsed.originalText);
              onClose();
            }}
            style={ghostButton}
            disabled={!parsed}
          >
            <Edit3 size={14} /> Edit
          </button>
          <button
            type="button"
            onClick={onClose}
            style={ghostButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRunClick}
            disabled={!parsed || !parsed.intent || runState.kind === "running"}
            style={runButton(
              Boolean(parsed?.intent) && runState.kind !== "running",
              runState.kind === "confirming",
            )}
          >
            {runState.kind === "running" ? (
              <>
                <Loader2 size={14} className="studio-spin" /> Running…
              </>
            ) : runState.kind === "confirming" ? (
              <>
                <Check size={14} /> Confirm &amp; Run
              </>
            ) : (
              <>
                <Check size={14} /> Run
              </>
            )}
          </button>
        </footer>

        <style>{`
          .studio-spin { animation: studio-assistant-spin 0.9s linear infinite; }
          @keyframes studio-assistant-spin { to { transform: rotate(360deg); } }
          @keyframes studio-assistant-fade {
            from { opacity: 0; } to { opacity: 1; }
          }
          @keyframes studio-assistant-slide {
            from { transform: translateX(20px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </aside>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Body                                                                      */
/* -------------------------------------------------------------------------- */

function PanelBody({
  parsed,
  runState,
  isWrite,
  onSuggestedCommand,
}: {
  parsed: ParsedAssistantCommand;
  runState: RunState;
  isWrite: boolean;
  onSuggestedCommand: (command: string) => void;
}) {
  const confidencePct = Math.round(parsed.confidence * 100);
  const confidenceColor =
    confidencePct >= 80
      ? "#15803d"
      : confidencePct >= 55
        ? "#c2410c"
        : "#b91c1c";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section>
        <SectionLabel>ORIGINAL COMMAND</SectionLabel>
        <div
          style={{
            marginTop: 6,
            padding: "12px 14px",
            borderRadius: 14,
            background: "#f7f7f8",
            border: `1px solid ${BORDER}`,
            fontSize: 14,
            color: TEXT_PRIMARY,
            lineHeight: 1.6,
            fontStyle: parsed.originalText ? "normal" : "italic",
          }}
        >
          {parsed.originalText || "(empty)"}
        </div>
      </section>

      <section>
        <SectionLabel>INTERPRETED INTENT</SectionLabel>
        <div
          style={{
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 14,
            border: `1px solid ${BORDER}`,
            background: SURFACE,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: parsed.intent ? ACCENT : "#cbd5f5",
              }}
            />
            <span style={{ fontSize: 15, fontWeight: 800, color: TEXT_PRIMARY }}>
              {intentLabel(parsed.intent)}
            </span>
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: confidenceColor,
              background: `${confidenceColor}14`,
              padding: "4px 10px",
              borderRadius: 999,
            }}
          >
            {confidencePct}% confidence
          </span>
        </div>
      </section>

      <section>
        <SectionLabel>PLANNED ACTION</SectionLabel>
        <div
          style={{
            marginTop: 6,
            padding: "12px 14px",
            borderRadius: 14,
            border: `1px solid ${BORDER}`,
            background: SURFACE,
            color: TEXT_PRIMARY,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {parsed.summary}
        </div>
      </section>

      <section>
        <SectionLabel>EXTRACTED PARAMETERS</SectionLabel>
        <ParamsTable params={parsed.params} />
      </section>

      {parsed.errors && parsed.errors.length > 0 ? (
        <section>
          <SectionLabel>NOTES</SectionLabel>
          <ul
            style={{
              marginTop: 6,
              padding: "10px 14px 10px 26px",
              border: `1px solid #fed7aa`,
              background: "#fff7ed",
              borderRadius: 14,
              color: "#9a3412",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {parsed.errors.map((err, idx) => (
              <li key={`${idx}-${err}`}>{err}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 14,
          border: `1px solid ${isWrite ? "#fee2e2" : "#dcfce7"}`,
          background: isWrite ? "#fff5f5" : "#f0fdf4",
          color: isWrite ? "#991b1b" : "#166534",
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {isWrite ? <Shield size={15} /> : <Check size={15} />}
        {isWrite
          ? "This is a write action — Studio Assistant will ask you to confirm before running it."
          : "This is a read-only preview. No data will be changed."}
      </section>

      <RunStateBanner
        runState={runState}
        intent={parsed.intent}
        onSuggestedCommand={onSuggestedCommand}
      />
    </div>
  );
}

function ParamsTable({
  params,
}: {
  params: Record<string, unknown>;
}) {
  const entries = Object.entries(params);
  if (entries.length === 0) {
    return (
      <div
        style={{
          marginTop: 6,
          padding: "12px 14px",
          border: `1px dashed ${BORDER}`,
          borderRadius: 14,
          color: TEXT_MUTED,
          fontSize: 13,
        }}
      >
        No parameters extracted.
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 6,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {entries.map(([key, raw], idx) => (
        <div
          key={key}
          style={{
            display: "grid",
            gridTemplateColumns: "140px 1fr",
            gap: 12,
            padding: "10px 14px",
            borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
            background: idx % 2 === 0 ? "#fff" : "#fafbfc",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: TEXT_MUTED, letterSpacing: "0.06em" }}>
            {key.replace(/_/g, " ").toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: TEXT_PRIMARY, wordBreak: "break-word" }}>
            {formatParam(raw)}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatParam(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function RunStateBanner({
  runState,
  intent,
  onSuggestedCommand,
}: {
  runState: RunState;
  intent: ParsedAssistantCommand["intent"];
  onSuggestedCommand: (command: string) => void;
}) {
  if (runState.kind === "idle") return null;
  if (runState.kind === "confirming") {
    return (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 14,
          background: "#fff7ed",
          border: `1px solid #fed7aa`,
          color: "#9a3412",
          fontSize: 13,
          lineHeight: 1.6,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <AlertTriangle size={16} style={{ marginTop: 2 }} />
        Press <strong>Confirm &amp; Run</strong> to execute this write action.
        Voice input alone will never run a write without this explicit confirmation.
      </div>
    );
  }
  if (runState.kind === "running") {
    return (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 14,
          background: "#eff6ff",
          border: `1px solid #bfdbfe`,
          color: "#1d4ed8",
          fontSize: 13,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Loader2 size={15} className="studio-spin" /> Preparing preview…
      </div>
    );
  }
  if (runState.kind === "success") {
    const suggestions = suggestionsForIntent(intent, runState.data);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            background: "#f0fdf4",
            border: `1px solid #bbf7d0`,
            color: "#166534",
            fontSize: 13,
            lineHeight: 1.6,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <Check size={16} style={{ marginTop: 2 }} />
          <span>{runState.message}</span>
        </div>
        {runState.data ? (
          <StructuredResult intent={intent} data={runState.data} />
        ) : null}
        {suggestions.length ? (
          <SuggestionsRow
            suggestions={suggestions}
            onSuggestedCommand={onSuggestedCommand}
          />
        ) : null}
      </div>
    );
  }
  if (runState.kind === "error") {
    return (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 14,
          background: "#fef2f2",
          border: `1px solid #fecaca`,
          color: "#991b1b",
          fontSize: 13,
          lineHeight: 1.6,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <AlertTriangle size={16} style={{ marginTop: 2 }} />
        {runState.message}
      </div>
    );
  }
  // blocked
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 14,
        background: "#fef2f2",
        border: `1px solid #fecaca`,
        color: "#991b1b",
        fontSize: 13,
        lineHeight: 1.6,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <AlertTriangle size={16} style={{ marginTop: 2 }} />
      {runState.reason}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Structured result views (Phase 3)                                         */
/* -------------------------------------------------------------------------- */

function StructuredResult({
  intent,
  data,
}: {
  intent: ParsedAssistantCommand["intent"];
  data: Record<string, unknown>;
}) {
  if (intent === "list_new_orders") return <OrdersResult data={data} />;
  if (intent === "find_school") return <SchoolsResult data={data} />;
  if (intent === "find_student") return <StudentsResult data={data} />;
  if (
    intent === "create_school" ||
    intent === "update_school_dates" ||
    intent === "release_school_gallery" ||
    intent === "toggle_school_access" ||
    intent === "assign_package_profile"
  ) {
    return <SingleSchoolResult data={data} />;
  }
  // Phase 5 — operations/insights result renderers.
  if (intent === "summarize_attention_items") return <AttentionResult data={data} />;
  if (
    intent === "summarize_pending_digital_orders" ||
    intent === "summarize_order_backlog"
  )
    return <OrdersByGroupResult data={data} />;
  if (intent === "summarize_sales_by_school") return <SalesBySchoolResult data={data} />;
  if (intent === "summarize_package_performance")
    return <PackagePerformanceResult data={data} />;
  if (intent === "review_release_warnings") return <ReleaseWarningsResult data={data} />;
  if (intent === "review_expiring_galleries") return <ExpiringGalleriesResult data={data} />;
  if (intent === "review_unreleased_with_preregistrations")
    return <UnreleasedPreregsResult data={data} />;
  if (intent === "summarize_today" || intent === "summarize_week")
    return <DailyWeeklySummaryResult data={data} intent={intent} />;
  // Phase 6 — gallery optimization.
  if (intent === "review_gallery_coverage")
    return <GalleryCoverageResult data={data} />;
  if (intent === "highlight_popular_media")
    return <PopularMediaResult data={data} />;
  if (intent === "suggest_upsell_sizes") return <UpsellSizesResult data={data} />;
  if (intent === "suggest_gallery_cover")
    return <CoverSuggestionsResult data={data} />;
  // Fallback — keep the old generic renderer for anything unexpected.
  return <ResultBlock data={data} />;
}

function OrdersResult({ data }: { data: Record<string, unknown> }) {
  const rows = (data.results as Array<Record<string, unknown>>) ?? [];
  if (!rows.length) {
    return (
      <div style={{ color: TEXT_MUTED, fontSize: 13, padding: "8px 2px" }}>
        No orders yet for this window.
      </div>
    );
  }
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {rows.slice(0, 8).map((row, idx) => (
        <div
          key={String(row.id ?? idx)}
          style={{
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
            background: idx % 2 === 0 ? "#fff" : "#fafbfc",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {String(row.customer_name ?? "Customer")}
            </div>
            <div style={{ fontSize: 11, color: TEXT_MUTED }}>
              {String(row.status ?? "pending")}
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
            {typeof row.total_cents === "number"
              ? `$${(row.total_cents / 100).toFixed(2)}`
              : ""}
          </div>
        </div>
      ))}
      {rows.length > 8 ? (
        <div style={{ padding: "8px 12px", color: TEXT_MUTED, fontSize: 12 }}>
          and {rows.length - 8} more
        </div>
      ) : null}
    </div>
  );
}

function SchoolsResult({ data }: { data: Record<string, unknown> }) {
  const rows = (data.results as Array<Record<string, unknown>>) ?? [];
  if (!rows.length) {
    return (
      <div style={{ color: TEXT_MUTED, fontSize: 13, padding: "8px 2px" }}>
        No schools match this search.
      </div>
    );
  }
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {rows.map((row, idx) => (
        <a
          key={String(row.id ?? idx)}
          href={row.id ? `/dashboard/projects/schools/${row.id}` : "/dashboard/schools"}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            textDecoration: "none",
            color: TEXT_PRIMARY,
            borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
            background: idx % 2 === 0 ? "#fff" : "#fafbfc",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800 }}>
            {String(row.school_name ?? "School")}
          </div>
          <div style={{ fontSize: 11, color: TEXT_MUTED }}>
            {String(row.status ?? "")}
          </div>
        </a>
      ))}
    </div>
  );
}

function StudentsResult({ data }: { data: Record<string, unknown> }) {
  const rows = (data.results as Array<Record<string, unknown>>) ?? [];
  if (!rows.length) {
    return (
      <div style={{ color: TEXT_MUTED, fontSize: 13, padding: "8px 2px" }}>
        No students match this search.
      </div>
    );
  }
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {rows.map((row, idx) => (
        <div
          key={String(row.id ?? idx)}
          style={{
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
            background: idx % 2 === 0 ? "#fff" : "#fafbfc",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
              {[row.first_name, row.last_name].filter(Boolean).join(" ") || "Student"}
            </div>
            <div style={{ fontSize: 11, color: TEXT_MUTED }}>
              {row.school_name ? String(row.school_name) : ""}
              {row.class_name ? ` · ${String(row.class_name)}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Phase 5 — operational result renderers                                    */
/* -------------------------------------------------------------------------- */

type Counts = Record<string, number | undefined>;

function SummaryChips({
  counts,
}: {
  counts: Array<{ label: string; value: string | number; tone?: "info" | "warn" | "danger" | "good" }>;
}) {
  const palette: Record<NonNullable<typeof counts[number]["tone"]>, { fg: string; bg: string }> = {
    info: { fg: "#1d4ed8", bg: "#eff6ff" },
    warn: { fg: "#9a3412", bg: "#fff7ed" },
    danger: { fg: "#991b1b", bg: "#fef2f2" },
    good: { fg: "#166534", bg: "#f0fdf4" },
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {counts.map((c, idx) => {
        const tone = palette[c.tone ?? "info"];
        return (
          <div
            key={idx}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              background: tone.bg,
              color: tone.fg,
              fontSize: 12,
              fontWeight: 800,
              lineHeight: 1.2,
              minWidth: 100,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 900 }}>{c.value}</div>
            <div style={{ letterSpacing: "0.08em" }}>{c.label.toUpperCase()}</div>
          </div>
        );
      })}
    </div>
  );
}

function urgencyTone(urgency?: string): { fg: string; bg: string; label: string } {
  switch (urgency) {
    case "high":
      return { fg: "#991b1b", bg: "#fef2f2", label: "HIGH" };
    case "medium":
      return { fg: "#9a3412", bg: "#fff7ed", label: "MEDIUM" };
    default:
      return { fg: "#1d4ed8", bg: "#eff6ff", label: "LOW" };
  }
}

function moneyFromCents(cents: unknown): string {
  const n = typeof cents === "number" ? cents : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (Number.isFinite(n) ? n : 0) / 100,
  );
}

function AttentionResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const items =
    (data.items as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          {
            label: "Needs attention",
            value: counts.needs_attention ?? 0,
            tone: (counts.needs_attention ?? 0) > 0 ? "warn" : "good",
          },
          {
            label: "High urgency",
            value: counts.high_urgency ?? 0,
            tone: (counts.high_urgency ?? 0) > 0 ? "danger" : "good",
          },
          { label: "Expiring soon", value: counts.expiring_soon ?? 0, tone: "warn" },
          {
            label: "Unreleased w/ interest",
            value: counts.unreleased_with_preregistrations ?? 0,
            tone: "warn",
          },
          { label: "Missing package", value: counts.missing_package_profile ?? 0 },
          { label: "Digital pending", value: counts.digital_pending ?? 0 },
          { label: "Order backlog", value: counts.order_backlog ?? 0 },
        ]}
      />
      {items.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13, padding: "8px 2px" }}>
          Nothing urgent right now.
        </div>
      ) : (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          {items.map((row, idx) => {
            const tone = urgencyTone(row.urgency as string | undefined);
            const schoolId = row.school_id as string | undefined;
            const reasons = (row.reasons as string[]) ?? [];
            const actions = (row.suggested_actions as string[]) ?? [];
            return (
              <div
                key={String(row.school_id ?? idx)}
                style={{
                  padding: "12px 14px",
                  borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                  background: idx % 2 === 0 ? "#fff" : "#fafbfc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: TEXT_PRIMARY }}>
                    {String(row.school_name ?? "School")}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing: "0.12em",
                      padding: "3px 8px",
                      borderRadius: 999,
                      color: tone.fg,
                      background: tone.bg,
                    }}
                  >
                    {tone.label}
                  </span>
                </div>
                {reasons.length ? (
                  <ul style={{ margin: "6px 0 0 18px", color: TEXT_MUTED, fontSize: 12, lineHeight: 1.6 }}>
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
                {actions.length ? (
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {schoolId ? (
                      <a
                        href={`/dashboard/projects/schools/${schoolId}`}
                        style={chipLink()}
                      >
                        Open school →
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrdersByGroupResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const groups = (data.groups as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          { label: "Total orders", value: counts.total_orders ?? 0 },
          { label: "Schools", value: counts.schools_with_orders ?? 0 },
        ]}
      />
      {groups.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>No matching orders right now.</div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, background: "#fff", overflow: "hidden" }}>
          {groups.map((g, idx) => (
            <div
              key={String(g.school_id ?? idx)}
              style={{
                padding: "10px 14px",
                borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                  {String(g.school_name ?? "School")}
                </div>
                <div style={{ fontSize: 12, color: TEXT_MUTED, fontWeight: 700 }}>
                  {String(g.order_count ?? 0)} orders · {moneyFromCents(g.total_cents)}
                </div>
              </div>
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {g.school_id ? (
                  <a href={`/dashboard/projects/schools/${g.school_id}`} style={chipLink()}>
                    Open school →
                  </a>
                ) : null}
                <a href="/dashboard/orders" style={chipLink()}>View orders →</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SalesBySchoolResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const groups = (data.groups as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          { label: "Orders", value: counts.orders ?? 0 },
          { label: "Schools", value: counts.schools ?? 0 },
          { label: "Revenue", value: moneyFromCents(counts.total_cents), tone: "good" },
        ]}
      />
      {groups.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>No sales recorded in this window.</div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, background: "#fff", overflow: "hidden" }}>
          {groups.map((g, idx) => (
            <div
              key={String(g.school_id ?? idx)}
              style={{
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                  {String(g.school_name ?? "School")}
                </div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>
                  {String(g.order_count ?? 0)} orders
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                {moneyFromCents(g.total_cents)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PackagePerformanceResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const groups = (data.groups as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          { label: "Packages", value: counts.packages ?? 0 },
          { label: "Orders", value: counts.orders ?? 0 },
        ]}
      />
      {groups.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>No package activity in this window.</div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, background: "#fff", overflow: "hidden" }}>
          {groups.map((g, idx) => (
            <div
              key={String(g.package_name ?? idx)}
              style={{
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                {String(g.package_name ?? "Unlabeled")}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                {String(g.order_count ?? 0)} · {moneyFromCents(g.total_cents)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReleaseWarningsResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          {
            label: "Not ready",
            value: counts.schools ?? 0,
            tone: (counts.schools ?? 0) > 0 ? "warn" : "good",
          },
        ]}
      />
      {items.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>All active schools look ready.</div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, background: "#fff", overflow: "hidden" }}>
          {items.map((row, idx) => {
            const issues = (row.issues as string[]) ?? [];
            return (
              <div
                key={String(row.school_id ?? idx)}
                style={{
                  padding: "12px 14px",
                  borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                  background: idx % 2 === 0 ? "#fff" : "#fafbfc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                    {String(row.school_name ?? "School")}
                  </div>
                  <div style={{ fontSize: 11, color: TEXT_MUTED }}>
                    {String(row.status ?? "")}
                  </div>
                </div>
                <ul
                  style={{
                    margin: "6px 0 0 18px",
                    color: "#9a3412",
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  {issues.map((i, k) => (
                    <li key={k}>{i}</li>
                  ))}
                </ul>
                <div style={{ marginTop: 6 }}>
                  {row.school_id ? (
                    <a href={`/dashboard/projects/schools/${row.school_id}`} style={chipLink()}>
                      Open school →
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExpiringGalleriesResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
  const withinDays = (data.within_days as number | undefined) ?? 7;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          {
            label: `Expiring in ${withinDays}d`,
            value: counts.schools ?? 0,
            tone: (counts.schools ?? 0) > 0 ? "warn" : "good",
          },
        ]}
      />
      {items.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>
          No galleries expire in the next {withinDays} day{withinDays === 1 ? "" : "s"}.
        </div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, background: "#fff", overflow: "hidden" }}>
          {items.map((row, idx) => (
            <div
              key={String(row.school_id ?? idx)}
              style={{
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                  {String(row.school_name ?? "School")}
                </div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>
                  Expires {String(row.expiration_date ?? "—")}
                </div>
              </div>
              {row.school_id ? (
                <a href={`/dashboard/projects/schools/${row.school_id}`} style={chipLink()}>
                  Open →
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UnreleasedPreregsResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          {
            label: "Schools with interest",
            value: counts.schools ?? 0,
            tone: (counts.schools ?? 0) > 0 ? "warn" : "good",
          },
        ]}
      />
      {items.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>
          No unreleased schools have preregistrations right now.
        </div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, background: "#fff", overflow: "hidden" }}>
          {items.map((row, idx) => (
            <div
              key={String(row.school_id ?? idx)}
              style={{
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                  {String(row.school_name ?? "School")}
                </div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>
                  {String(row.preregistration_count ?? 0)} preregistration
                  {Number(row.preregistration_count ?? 0) === 1 ? "" : "s"}
                </div>
              </div>
              {row.school_id ? (
                <a href={`/dashboard/projects/schools/${row.school_id}`} style={chipLink()}>
                  Open →
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DailyWeeklySummaryResult({
  data,
  intent,
}: {
  data: Record<string, unknown>;
  intent: ParsedAssistantCommand["intent"];
}) {
  const counts = (data.counts as Counts) ?? {};
  if (intent === "summarize_today") {
    return (
      <SummaryChips
        counts={[
          { label: "New orders today", value: counts.new_orders_today ?? 0, tone: "good" },
          { label: "Revenue today", value: moneyFromCents(counts.revenue_today_cents), tone: "good" },
          { label: "Needs attention", value: counts.needs_attention ?? 0, tone: "warn" },
          { label: "Expiring ≤ 3d", value: counts.expiring_within_3_days ?? 0, tone: "warn" },
        ]}
      />
    );
  }
  return (
    <SummaryChips
      counts={[
        { label: "Orders this week", value: counts.orders_this_week ?? 0, tone: "good" },
        { label: "Revenue", value: moneyFromCents(counts.revenue_week_cents), tone: "good" },
        { label: "Needs attention", value: counts.needs_attention ?? 0, tone: "warn" },
        { label: "Expiring ≤ 7d", value: counts.expiring_within_7_days ?? 0, tone: "warn" },
        { label: "Digital pending", value: counts.digital_pending ?? 0 },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Phase 6 renderers                                                         */
/* -------------------------------------------------------------------------- */

function GalleryCoverageResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const school = data.school as { id?: string; school_name?: string } | null;
  const missingByClass =
    (data.missing_by_class as Array<Record<string, unknown>> | undefined) ?? [];
  const sampleMissing =
    (data.sample_missing as Array<Record<string, unknown>> | undefined) ?? [];
  const coverage = counts.coverage_pct ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          { label: "Students", value: counts.total_students ?? 0 },
          {
            label: "With photo",
            value: counts.with_photo ?? 0,
            tone: coverage >= 90 ? "good" : "info",
          },
          {
            label: "Missing",
            value: counts.missing_photo ?? 0,
            tone: (counts.missing_photo ?? 0) > 0 ? "warn" : "good",
          },
          {
            label: "Coverage",
            value: `${coverage}%`,
            tone: coverage >= 90 ? "good" : coverage >= 70 ? "info" : "warn",
          },
        ]}
      />

      {missingByClass.length ? (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: TEXT_MUTED,
              padding: "10px 14px 4px",
            }}
          >
            MISSING BY CLASS
          </div>
          {missingByClass.map((row, idx) => (
            <div
              key={idx}
              style={{
                padding: "8px 14px",
                display: "flex",
                justifyContent: "space-between",
                borderTop: `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
                fontSize: 13,
              }}
            >
              <span style={{ color: TEXT_PRIMARY, fontWeight: 700 }}>
                {String(row.class_name ?? "(no class)")}
              </span>
              <span style={{ color: "#9a3412", fontWeight: 800 }}>
                {String(row.missing ?? 0)} missing
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {sampleMissing.length ? (
        <div style={{ color: TEXT_MUTED, fontSize: 12, lineHeight: 1.6 }}>
          Sample:{" "}
          {sampleMissing
            .map((s) => String(s.name))
            .slice(0, 6)
            .join(", ")}
          {sampleMissing.length > 6 ? ", …" : ""}
        </div>
      ) : null}

      {school?.id ? (
        <div>
          <a
            href={`/dashboard/projects/schools/${school.id}`}
            style={chipLink()}
          >
            Open {String(school.school_name ?? "school")} →
          </a>
        </div>
      ) : null}
    </div>
  );
}

function PopularMediaResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
  const school = data.school as { id?: string; school_name?: string } | null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          { label: "Popular students", value: counts.popular_students ?? 0 },
        ]}
      />
      {items.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>
          No order-based popularity signals yet.
        </div>
      ) : (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          {items.map((row, idx) => (
            <div
              key={String(row.student_id ?? idx)}
              style={{
                padding: "10px 14px",
                display: "flex",
                gap: 12,
                alignItems: "center",
                borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
              }}
            >
              {row.photo_url ? (
                // Small 40x40 thumbnail from arbitrary user-content URLs —
                // next/image would require registering every possible host.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(row.photo_url)}
                  alt=""
                  loading="lazy"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    objectFit: "cover",
                    border: `1px solid ${BORDER}`,
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  aria-hidden
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: "#f3f4f6",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: TEXT_PRIMARY,
                  }}
                >
                  {String(row.name ?? "Student")}
                </div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>
                  {row.class_name ? `${String(row.class_name)} · ` : ""}
                  {String(row.order_count ?? 0)} orders
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: "0.12em",
                  padding: "3px 8px",
                  borderRadius: 999,
                  color: "#166534",
                  background: "#f0fdf4",
                }}
              >
                POPULAR
              </span>
            </div>
          ))}
        </div>
      )}
      {school?.id ? (
        <div>
          <a href={`/dashboard/projects/schools/${school.id}`} style={chipLink()}>
            Open {String(school.school_name ?? "school")} →
          </a>
        </div>
      ) : null}
    </div>
  );
}

function UpsellSizesResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
  const school = data.school as { id?: string; school_name?: string } | null;
  const since = data.since as string | undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          { label: "Items tracked", value: counts.items ?? 0 },
          { label: "Since", value: since ?? "—" },
        ]}
      />
      {items.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>
          No sold items in the last 90 days.
        </div>
      ) : (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          {items.map((row, idx) => (
            <div
              key={String(row.product_name ?? idx)}
              style={{
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                background: idx % 2 === 0 ? "#fff" : "#fafbfc",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                {String(row.product_name ?? "Unlabeled")}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
                {String(row.count ?? 0)} sold · {moneyFromCents(row.revenue_cents)}
              </div>
            </div>
          ))}
        </div>
      )}
      {school?.id ? (
        <div>
          <a href={`/dashboard/projects/schools/${school.id}`} style={chipLink()}>
            Open {String(school.school_name ?? "school")} →
          </a>
        </div>
      ) : null}
    </div>
  );
}

function CoverSuggestionsResult({ data }: { data: Record<string, unknown> }) {
  const counts = (data.counts as Counts) ?? {};
  const cands =
    (data.candidates as Array<Record<string, unknown>> | undefined) ?? [];
  const school = data.school as { id?: string; school_name?: string } | null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryChips
        counts={[
          {
            label: "Candidates",
            value: counts.candidates ?? 0,
            tone: (counts.candidates ?? 0) > 0 ? "good" : "info",
          },
        ]}
      />
      <div
        style={{
          fontSize: 12,
          color: TEXT_MUTED,
          lineHeight: 1.6,
        }}
      >
        Suggestions are based on actual order signals. No image analysis is
        performed. Open the school to review and apply a cover.
      </div>
      {cands.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 13 }}>
          No candidate cover photos surfaced.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 10,
          }}
        >
          {cands.map((c, idx) => (
            <div
              key={idx}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                background: "#fff",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {c.photo_url ? (
                // Cover suggestion thumbnail from arbitrary user-content URLs —
                // next/image would require registering every possible host.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(c.photo_url)}
                  alt=""
                  loading="lazy"
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: 10,
                  }}
                />
              ) : (
                <div
                  aria-hidden
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 10,
                    background: "#f3f4f6",
                  }}
                />
              )}
              <div style={{ fontSize: 12, fontWeight: 800, color: TEXT_PRIMARY }}>
                {String(c.name ?? "Suggested")}
              </div>
              <div style={{ fontSize: 10, color: TEXT_MUTED, lineHeight: 1.4 }}>
                {String(c.reason ?? "")}
              </div>
            </div>
          ))}
        </div>
      )}
      {school?.id ? (
        <div>
          <a href={`/dashboard/projects/schools/${school.id}`} style={chipLink()}>
            Open {String(school.school_name ?? "school")} to apply →
          </a>
        </div>
      ) : null}
    </div>
  );
}

function chipLink(): React.CSSProperties {
  return {
    border: `1px solid ${BORDER}`,
    background: "#fff",
    color: TEXT_PRIMARY,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textDecoration: "none",
  };
}

function SingleSchoolResult({ data }: { data: Record<string, unknown> }) {
  const school = data.school as Record<string, unknown> | undefined;
  if (!school) return <ResultBlock data={data} />;
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: "10px 12px",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_PRIMARY }}>
        {String(school.school_name ?? "School")}
      </div>
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>
        {school.status ? `Status: ${String(school.status)}` : null}
        {school.shoot_date ? ` · Shoot ${String(school.shoot_date)}` : null}
      </div>
    </div>
  );
}

function SuggestionsRow({
  suggestions,
  onSuggestedCommand,
}: {
  suggestions: AssistantSuggestion[];
  onSuggestedCommand: (command: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: "#f7f7f8",
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          fontWeight: 800,
          color: TEXT_MUTED,
        }}
      >
        NEXT STEPS
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {suggestions.map((s, idx) => {
          const common: React.CSSProperties = {
            border: `1px solid ${BORDER}`,
            background: "#fff",
            color: TEXT_PRIMARY,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
            cursor: "pointer",
          };
          if (s.href) {
            return (
              <a key={idx} href={s.href} style={common}>
                {s.label} →
              </a>
            );
          }
          return (
            <button
              key={idx}
              type="button"
              onClick={() => s.command && onSuggestedCommand(s.command)}
              style={common}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Minimal result renderer — kept for unknown intents as a fallback.
 */
function ResultBlock({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data ?? {});
  if (!entries.length) return null;
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        background: "#fff",
        padding: "10px 12px",
        maxHeight: 240,
        overflow: "auto",
      }}
    >
      {entries.map(([key, value]) => (
        <div key={key} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: TEXT_MUTED,
              marginBottom: 4,
            }}
          >
            {key.replace(/_/g, " ").toUpperCase()}
          </div>
          <ResultValue value={value} />
        </div>
      ))}
    </div>
  );
}

function ResultValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: TEXT_MUTED, fontSize: 13 }}>None</span>;
    }
    return (
      <ul style={{ margin: 0, paddingLeft: 16, color: TEXT_PRIMARY, fontSize: 13 }}>
        {value.slice(0, 10).map((item, idx) => (
          <li key={idx} style={{ marginBottom: 2 }}>
            {summarizeItem(item)}
          </li>
        ))}
        {value.length > 10 ? (
          <li style={{ color: TEXT_MUTED }}>and {value.length - 10} more…</li>
        ) : null}
      </ul>
    );
  }
  if (value && typeof value === "object") {
    return (
      <pre
        style={{
          margin: 0,
          fontSize: 12,
          color: TEXT_PRIMARY,
          background: "#fafbfc",
          padding: "6px 8px",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return (
    <span style={{ color: TEXT_PRIMARY, fontSize: 13 }}>
      {String(value ?? "—")}
    </span>
  );
}

function summarizeItem(item: unknown): string {
  if (!item || typeof item !== "object") return String(item);
  const obj = item as Record<string, unknown>;
  const name =
    obj.school_name ??
    obj.name ??
    [obj.first_name, obj.last_name].filter(Boolean).join(" ") ??
    obj.customer_name ??
    null;
  const extra =
    obj.status ?? obj.class_name ?? obj.total_cents ?? obj.created_at ?? null;
  if (name && extra) return `${name} — ${extra}`;
  if (name) return String(name);
  try {
    return JSON.stringify(obj);
  } catch {
    return "[object]";
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: "0.12em",
        fontWeight: 800,
        color: TEXT_MUTED,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Buttons                                                                   */
/* -------------------------------------------------------------------------- */

const ghostButton: React.CSSProperties = {
  height: 38,
  padding: "0 14px",
  background: "#fff",
  color: TEXT_PRIMARY,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

function runButton(enabled: boolean, confirming: boolean): React.CSSProperties {
  return {
    height: 38,
    padding: "0 18px",
    borderRadius: 12,
    border: "none",
    background: enabled
      ? confirming
        ? ACCENT
        : "#0f172a"
      : "#e5e7eb",
    color: enabled ? "#fff" : "#94a3b8",
    fontWeight: 800,
    fontSize: 13,
    cursor: enabled ? "pointer" : "not-allowed",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: "background 0.15s ease",
  };
}
