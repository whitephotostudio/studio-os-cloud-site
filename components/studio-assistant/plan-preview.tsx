"use client";

// Studio Assistant — multi-step plan preview (Phase 4).
//
// Renders the list of steps, shows per-step confirmation requirement, live
// status, and a "Run plan" / "Cancel" pair.  Partial completion is reported
// honestly when a step fails mid-run.

import { AlertTriangle, Check, Loader2, Shield, Sparkles, X } from "lucide-react";
import {
  AssistantExecutionPlan,
  AssistantPlannedStep,
} from "@/lib/studio-assistant/plan-types";
import { intentLabel } from "@/lib/studio-assistant/types";

const BORDER = "#e5e7eb";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#667085";
const ACCENT = "#cc0000";
const SURFACE = "#ffffff";

export type PlanPreviewProps = {
  open: boolean;
  plan: AssistantExecutionPlan | null;
  runState:
    | { kind: "idle" }
    | { kind: "confirming" }
    | { kind: "running"; stepIndex: number }
    | { kind: "completed"; stoppedAt: number | null };
  onRun: () => void;
  onCancel: () => void;
  onClose: () => void;
};

export function PlanPreview({
  open,
  plan,
  runState,
  onRun,
  onCancel,
  onClose,
}: PlanPreviewProps) {
  if (!open || !plan) return null;

  const anyWrite = plan.requiresConfirmation;
  const confirming = runState.kind === "confirming";
  const running = runState.kind === "running";
  const done = runState.kind === "completed";

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.32)",
          zIndex: 90,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Studio Assistant plan"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(520px, 100%)",
          background: SURFACE,
          borderLeft: `1px solid ${BORDER}`,
          boxShadow: "-24px 0 60px rgba(15,23,42,0.16)",
          zIndex: 91,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "22px 22px 18px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
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
              <div style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 800, color: TEXT_MUTED }}>
                STUDIO ASSISTANT
              </div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: TEXT_PRIMARY }}>
                Multi-step plan
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plan"
            style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: 22, flex: 1, overflowY: "auto" }}>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 14,
              background: "#f7f7f8",
              border: `1px solid ${BORDER}`,
              color: TEXT_PRIMARY,
              fontSize: 14,
              lineHeight: 1.6,
              marginBottom: 14,
            }}
          >
            {plan.summary}
          </div>

          {plan.errors && plan.errors.length ? (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                background: "#fff7ed",
                border: "1px solid #fed7aa",
                color: "#9a3412",
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              {plan.errors.join(" ")}
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {plan.steps.map((step, idx) => (
              <StepCard
                key={step.stepId || idx}
                step={step}
                index={idx}
                isCurrent={running && runState.stepIndex === idx}
              />
            ))}
          </div>

          {anyWrite ? (
            <div
              style={{
                marginTop: 16,
                padding: "10px 14px",
                borderRadius: 14,
                background: "#fff5f5",
                border: "1px solid #fee2e2",
                color: "#991b1b",
                fontSize: 13,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <Shield size={15} style={{ marginTop: 2 }} />
              One or more write steps in this plan need on-screen confirmation
              before they can run.
            </div>
          ) : null}

          {done && runState.kind === "completed" ? (
            <div
              style={{
                marginTop: 16,
                padding: "10px 14px",
                borderRadius: 14,
                background: runState.stoppedAt === null ? "#f0fdf4" : "#fff7ed",
                border: `1px solid ${runState.stoppedAt === null ? "#bbf7d0" : "#fed7aa"}`,
                color: runState.stoppedAt === null ? "#166534" : "#9a3412",
                fontSize: 13,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              {runState.stoppedAt === null ? (
                <Check size={16} style={{ marginTop: 2 }} />
              ) : (
                <AlertTriangle size={16} style={{ marginTop: 2 }} />
              )}
              {runState.stoppedAt === null
                ? "All steps completed."
                : `Stopped at step ${runState.stoppedAt + 1}. Earlier steps are already applied — review the results above.`}
            </div>
          ) : null}
        </div>

        <footer
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: "14px 22px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            background: "#fafafa",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={running}
            style={ghostButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={running || plan.steps.length === 0}
            style={runButton(plan.steps.length > 0 && !running, confirming)}
          >
            {running ? (
              <>
                <Loader2 size={14} className="studio-spin" /> Running…
              </>
            ) : confirming ? (
              <>
                <Check size={14} /> Confirm &amp; run plan
              </>
            ) : (
              <>
                <Check size={14} /> Run plan
              </>
            )}
          </button>
        </footer>

        <style>{`
          .studio-spin { animation: studio-assistant-spin 0.9s linear infinite; }
          @keyframes studio-assistant-spin { to { transform: rotate(360deg); } }
        `}</style>
      </aside>
    </>
  );
}

function StepCard({
  step,
  index,
  isCurrent,
}: {
  step: AssistantPlannedStep;
  index: number;
  isCurrent: boolean;
}) {
  const status = step.status ?? "pending";
  const { bg, border, color, icon } = statusTokens(status, isCurrent);
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        background: bg,
        borderRadius: 14,
        padding: "12px 14px",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 99,
          background: "#fff",
          border: `1px solid ${border}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {icon ?? <span style={{ fontSize: 12, fontWeight: 900 }}>{index + 1}</span>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            fontWeight: 800,
            color: TEXT_MUTED,
            marginBottom: 2,
          }}
        >
          {intentLabel(step.intent).toUpperCase()}
          {step.requiresConfirmation ? " · WRITE" : " · READ"}
        </div>
        <div style={{ fontSize: 14, color: TEXT_PRIMARY, fontWeight: 700 }}>
          {step.summary}
        </div>
        {step.result && !step.result.ok ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "#991b1b" }}>
            {step.result.message}
          </div>
        ) : null}
        {step.result && step.result.ok ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "#166534" }}>
            {step.result.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function statusTokens(
  status: NonNullable<AssistantPlannedStep["status"]>,
  isCurrent: boolean,
): { bg: string; border: string; color: string; icon?: React.ReactNode } {
  if (isCurrent || status === "running") {
    return {
      bg: "#eff6ff",
      border: "#bfdbfe",
      color: "#1d4ed8",
      icon: <Loader2 size={13} className="studio-spin" />,
    };
  }
  if (status === "completed") {
    return {
      bg: "#f0fdf4",
      border: "#bbf7d0",
      color: "#166534",
      icon: <Check size={13} />,
    };
  }
  if (status === "failed") {
    return {
      bg: "#fef2f2",
      border: "#fecaca",
      color: "#991b1b",
      icon: <AlertTriangle size={13} />,
    };
  }
  if (status === "skipped") {
    return { bg: "#fafafa", border: BORDER, color: TEXT_MUTED };
  }
  return { bg: "#fff", border: BORDER, color: TEXT_MUTED };
}

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
    background: enabled ? (confirming ? ACCENT : "#0f172a") : "#e5e7eb",
    color: enabled ? "#fff" : "#94a3b8",
    fontWeight: 800,
    fontSize: 13,
    cursor: enabled ? "pointer" : "not-allowed",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
}
