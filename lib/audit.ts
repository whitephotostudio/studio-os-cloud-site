/**
 * Audit logging helper.
 *
 * Every mutating dashboard route should call recordAudit() after a
 * consequential action (writes, deletes, access changes, refunds).
 *
 * Design rules:
 *   1. Never throws.  An audit failure must not 500 a legitimate user
 *      request.  All errors are swallowed with a warn.
 *   2. Never logs secrets.  Callers are expected to pass already-shaped
 *      `before`/`after` snapshots, but as a belt-and-suspenders safety net
 *      we strip any key that looks like a credential before insert.
 *   3. Runs via the service client so RLS can stay strict (no write policy
 *      for authenticated/anon roles).
 *
 * See supabase/migrations/20260422120000_create_audit_log.sql for the
 * table shape + retention cron.
 */

import type { NextRequest } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp } from "@/lib/rate-limit";

export type AuditResult = "ok" | "denied" | "error";

export type AuditParams = {
  request: NextRequest;

  /** Already-resolved actor identity from resolveDashboardAuth(). */
  actorUserId?: string | null;
  /** Photographer row id of the actor, if known. */
  actorPhotographerId?: string | null;

  /** Dotted action identifier, e.g. "school.update", "order.refund". */
  action: string;
  /** Canonical entity type — "school","project","album","student","order","media","backdrop","photographer","mfa","visitor". */
  entityType: string;
  /** Primary key of the affected row (uuid or external id). */
  entityId?: string | null;

  /** Photographer id of the affected tenant (may equal actorPhotographerId). */
  targetPhotographerId?: string | null;

  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;

  result: AuditResult;
  errorMessage?: string | null;
  durationMs?: number | null;
};

/** Keys stripped from any before/after/metadata payload on their way to the log. */
const SENSITIVE_KEY_PATTERN =
  /(pin|password|passcode|token|secret|api[_-]?key|authorization|auth[_-]?code|access[_-]?pin)/i;

function sanitize(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = v == null ? null : "[redacted]";
      continue;
    }
    // One level of nested-object sanitization is enough for our call sites
    // (we never pass deeply nested data to the audit log).
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitize(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Fire-and-forget audit row insert.  Awaitable (so tests can assert on
 * completion) but guaranteed to never throw.
 */
export async function recordAudit(params: AuditParams): Promise<void> {
  try {
    const service = createDashboardServiceClient();
    const userAgent = params.request.headers.get("user-agent")?.slice(0, 500) ?? null;
    const ipRaw = getClientIp(params.request);
    const ip = ipRaw && ipRaw !== "unknown" ? ipRaw : null;

    const { error } = await service.from("audit_log").insert({
      actor_user_id: params.actorUserId ?? null,
      actor_photographer_id: params.actorPhotographerId ?? null,
      actor_ip: ip,
      actor_user_agent: userAgent,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      target_photographer_id:
        params.targetPhotographerId ?? params.actorPhotographerId ?? null,
      before: sanitize(params.before ?? null),
      after: sanitize(params.after ?? null),
      metadata: sanitize(params.metadata ?? {}) ?? {},
      result: params.result,
      error_message: params.errorMessage ?? null,
      duration_ms: params.durationMs ?? null,
    });

    if (error) {
      console.warn("[audit] insert failed:", error.message ?? error);
    }
  } catch (err) {
    // Never let audit bookkeeping crash a real request.
    console.warn("[audit] recordAudit threw — swallowed:", err);
  }
}

/**
 * Pick only the keys that are present in both `before` and `after` with
 * different values.  Useful at call sites that have full rows on hand and
 * want the audit log to show just the fields that actually changed.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
  keys: (keyof T)[],
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  if (!before || !after) {
    if (before) for (const k of keys) b[k] = before[k];
    if (after) for (const k of keys) a[k] = after[k];
    return { before: b, after: a };
  }
  for (const k of keys) {
    if (before[k] !== after[k]) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}
