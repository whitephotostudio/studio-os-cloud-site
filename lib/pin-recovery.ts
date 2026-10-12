// PIN recovery server-side logic.
//
// The 5-door check + token issue/claim. Pure server-side; uses a service-role
// Supabase client so it can read pre-registration tables and write to the
// recovery audit log without RLS getting in the way.
//
// Spec: docs/design/combine-orders-and-recovery.md (section 4.4 + 9).

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Tunables ──────────────────────────────────────────────────────────

/** How long a recovery token stays valid after issuance. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Rate-limit windows. Tighter than the agreement gate because recovery
 * is a higher-value attack target.
 */
export const RATE_LIMIT_PER_IP = {
  attempts: 3,
  windowMs: 15 * 60 * 1000, // 15 minutes
};
export const RATE_LIMIT_PER_STUDENT_PER_DAY = 10;

// ── Types ─────────────────────────────────────────────────────────────

export type RecoveryRequestInput = {
  /** Lowercased + trimmed at the call site. */
  email: string;
  firstName: string;
  lastName: string;
  /** Either schoolId (school mode) or projectId (event mode), never both. */
  schoolId?: string | null;
  projectId?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type DoorFailure =
  | "no_student_match"
  | "email_mismatch"
  | "email_not_registered"
  | "photographer_fallback"
  | "rate_limited"
  | "internal_error";

export type RecoverySuccess = {
  ok: true;
  /** The plaintext token to embed in the recovery URL.  Email it once, never persist. */
  plaintextToken: string;
  /** The student we matched. Caller can compose the email body. */
  student: ResolvedStudent;
  /** The studio that owns the gallery — used for sender info + the contact-us fallback. */
  photographer: ResolvedPhotographer;
};

export type RecoveryFailure = {
  ok: false;
  reason: DoorFailure;
  /** When the recovery falls through to Tier 3 (photographer-assisted), we surface the contact info to the client. */
  photographerContact?: ResolvedPhotographerContact | null;
};

export type ResolvedStudent = {
  id: string;
  firstName: string;
  lastName: string;
  parentEmail: string | null;
  schoolId: string | null;
  projectId: string | null;
  schoolName: string | null;
  /** For event mode: the project title. */
  projectTitle: string | null;
};

export type ResolvedPhotographer = {
  id: string;
  businessName: string | null;
  studioEmail: string | null;
  billingEmail: string | null;
  studioPhone: string | null;
};

export type ResolvedPhotographerContact = {
  businessName: string | null;
  email: string | null;
  phone: string | null;
};

// ── Token helpers ─────────────────────────────────────────────────────

/** Generate a 32-byte URL-safe token. ~256 bits of entropy. */
export function generatePlaintextToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Hash a plaintext token with SHA-256.  Used as the storage key. */
export function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export function pinRecoveryOrigin() {
  // Deployment configuration is trusted; request Origin/Host headers are not.
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_SITE_URL || "");
    if (configured.protocol === "https:" && !configured.username && !configured.password) {
      return configured.origin;
    }
  } catch { /* Missing/invalid configuration uses the canonical production URL. */ }
  return "https://www.studiooscloud.com";
}

// ── 5-door check ──────────────────────────────────────────────────────

type ServiceClient = SupabaseClient;

/**
 * Run the recovery check. Caller is responsible for inserting a row into
 * `pin_recovery_attempts` afterward (we return the data to log; that way
 * the caller controls when the row is committed and we can keep this fn
 * focused on the decision).
 *
 * Door order:
 *   1. Rate limit (by IP + by student per day)
 *   2. Student lookup (firstName + lastName + school OR project)
 *   3. Pre-registration check (email is in pre_release_registrations / pre_release_emails)
 *   4. Require the student's trusted roster email; school-wide registrations
 *      do not establish an email/student relationship.
 *   5. Token issue (random 32-byte → SHA-256 hash → store row)
 */
export async function runRecoveryDoorCheck(
  service: ServiceClient,
  input: RecoveryRequestInput,
): Promise<RecoverySuccess | RecoveryFailure> {
  // --- Door 1: rate limit ---------------------------------------------------
  if (input.ipAddress) {
    const sinceIso = new Date(
      Date.now() - RATE_LIMIT_PER_IP.windowMs,
    ).toISOString();
    const { count, error } = await service
      .from("pin_recovery_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", input.ipAddress)
      .gte("created_at", sinceIso);
    if (error) return { ok: false, reason: "internal_error" };
    if ((count ?? 0) >= RATE_LIMIT_PER_IP.attempts) {
      return { ok: false, reason: "rate_limited" };
    }
  }

  // --- Door 2: student lookup ----------------------------------------------
  let student: ResolvedStudent | null = null;
  let photographerId: string | null = null;

  if (input.schoolId) {
    const { data, error } = await service
      .from("students")
      .select(
        "id, first_name, last_name, parent_email, school_id, schools:schools!students_school_id_fkey!inner(id, school_name, photographer_id)",
      )
      .eq("school_id", input.schoolId)
      .ilike("first_name", escapeLikePattern(input.firstName))
      .ilike("last_name", escapeLikePattern(input.lastName))
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, reason: "internal_error" };
    if (!data) return { ok: false, reason: "no_student_match" };

    const schoolRow = Array.isArray(data.schools) ? data.schools[0] : data.schools;
    student = {
      id: data.id as string,
      firstName: (data.first_name as string) || "",
      lastName: (data.last_name as string) || "",
      parentEmail: (data.parent_email as string | null) ?? null,
      schoolId: (data.school_id as string | null) ?? null,
      projectId: null,
      schoolName: (schoolRow?.school_name as string | null) ?? null,
      projectTitle: null,
    };
    photographerId = (schoolRow?.photographer_id as string | null) ?? null;
  } else if (input.projectId) {
    // Event mode: there's no per-student PIN today (the event has one PIN),
    // but we still scope by project. The "student" lookup degenerates to
    // a project lookup; the recovery flow sends the parent into the event
    // gallery directly. No firstName/lastName matching is meaningful here
    // since it's a generic event PIN. This branch is wired for parity but
    // currently unused by the parents drawer (event combine doesn't have
    // per-student PINs). Kept as a stub to be filled in Phase 2 if events
    // ever introduce per-attendee PINs.
    return { ok: false, reason: "no_student_match" };
  } else {
    return { ok: false, reason: "no_student_match" };
  }

  if (!photographerId) {
    return { ok: false, reason: "internal_error" };
  }

  // --- Per-student per-day rate limit -------------------------------------
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: studentDayCount, error: studentDayError } = await service
    .from("pin_recovery_attempts")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student.id)
    .gte("created_at", dayAgoIso);
  if (studentDayError) return { ok: false, reason: "internal_error" };
  if ((studentDayCount ?? 0) >= RATE_LIMIT_PER_STUDENT_PER_DAY) {
    return { ok: false, reason: "rate_limited" };
  }

  // --- Resolve photographer (needed even on door 3 failure for the contact card) ---
  const photographer = await loadPhotographer(service, photographerId);
  const photographerContact: ResolvedPhotographerContact = {
    businessName: photographer?.businessName ?? null,
    email: photographer?.studioEmail || photographer?.billingEmail || null,
    phone: photographer?.studioPhone ?? null,
  };

  // --- Door 3: pre-registration check ------------------------------------
  if (input.schoolId) {
    const { data: preReg, error: preErr } = await service
      .from("pre_release_registrations")
      .select("id")
      .eq("school_id", input.schoolId)
      .ilike("email", escapeLikePattern(input.email))
      .limit(1)
      .maybeSingle();
    if (preErr) return { ok: false, reason: "internal_error" };
    if (!preReg) {
      return {
        ok: false,
        reason: "email_not_registered",
        photographerContact,
      };
    }
  } else if (input.projectId) {
    const { data: preReg } = await service
      .from("pre_release_emails")
      .select("id")
      .eq("project_id", input.projectId)
      .ilike("email", escapeLikePattern(input.email))
      .limit(1)
      .maybeSingle();
    if (!preReg) {
      return {
        ok: false,
        reason: "email_not_registered",
        photographerContact,
      };
    }
  }

  // --- Door 4: require a student-specific trusted email -------------------
  const rosterEmail = student.parentEmail?.trim().toLowerCase();
  if (!rosterEmail) {
    return { ok: false, reason: "photographer_fallback", photographerContact };
  }
  if (rosterEmail !== input.email.toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }

  // --- Door 5: issue token ------------------------------------------------
  if (!photographer) {
    return { ok: false, reason: "internal_error" };
  }
  const plaintextToken = generatePlaintextToken();
  const tokenHash = hashToken(plaintextToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error: insertErr } = await service
    .from("pin_recovery_tokens")
    .insert({
      token_hash: tokenHash,
      student_id: student.id,
      photographer_id: photographer.id,
      parent_email: input.email,
      expires_at: expiresAt,
    });
  if (insertErr) return { ok: false, reason: "internal_error" };

  return {
    ok: true,
    plaintextToken,
    student,
    photographer,
  };
}

/**
 * Validate + consume a recovery token. Single-use: marks it `used_at` on success.
 */
export async function claimRecoveryToken(
  service: ServiceClient,
  args: { plaintextToken: string; ipAddress: string | null; userAgent: string | null },
): Promise<
  | { ok: true; studentId: string; photographerId: string; parentEmail: string }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "internal_error" }
> {
  const tokenHash = hashToken(args.plaintextToken);
  const { data, error } = await service
    .from("pin_recovery_tokens")
    .select(
      "id, student_id, photographer_id, parent_email, expires_at, used_at, manual_request_id",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) return { ok: false, reason: "internal_error" };
  if (!data) return { ok: false, reason: "not_found" };

  if (data.used_at) return { ok: false, reason: "already_used" };

  const expiresAtMs = new Date(data.expires_at as string).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Recheck the student/email association when redeeming, including tokens
  // issued before strict recovery checks were introduced. A photographer's
  // explicit approved request can authorize a missing roster email.
  const { data: student, error: studentError } = await service
    .from("students")
    .select("id,parent_email,schools:schools!students_school_id_fkey!inner(photographer_id)")
    .eq("id", data.student_id)
    .maybeSingle();
  if (studentError) return { ok: false, reason: "internal_error" };
  const school = Array.isArray(student?.schools) ? student.schools[0] : student?.schools;
  if (!student || school?.photographer_id !== data.photographer_id) {
    return { ok: false, reason: "not_found" };
  }
  if (data.manual_request_id) {
    const { data: approved, error: approvedError } = await service
      .from("pin_recovery_requests")
      .select("id,student_id,photographer_id,parent_email,status")
      .eq("id", data.manual_request_id)
      .eq("student_id", data.student_id)
      .eq("photographer_id", data.photographer_id)
      .eq("status", "approved")
      .maybeSingle();
    if (approvedError) return { ok: false, reason: "internal_error" };
    if (!approved || approved.parent_email.trim().toLowerCase() !== data.parent_email.trim().toLowerCase()) {
      return { ok: false, reason: "not_found" };
    }
  } else if (!student.parent_email?.trim() || student.parent_email.trim().toLowerCase() !== data.parent_email.trim().toLowerCase()) {
    return { ok: false, reason: "not_found" };
  }

  // Consume only an unused, still-valid row. The database evaluates these
  // predicates atomically so concurrent claims cannot both receive access.
  const usedAt = new Date().toISOString();
  const { data: consumed, error: updateErr } = await service
    .from("pin_recovery_tokens")
    .update({
      used_at: usedAt,
      ip_used: args.ipAddress,
      user_agent_used: args.userAgent,
    })
    .eq("id", data.id)
    .is("used_at", null)
    .gt("expires_at", usedAt)
    .select("student_id, photographer_id, parent_email")
    .maybeSingle();
  if (updateErr) return { ok: false, reason: "internal_error" };
  if (!consumed) return { ok: false, reason: "already_used" };

  return {
    ok: true,
    studentId: consumed.student_id as string,
    photographerId: consumed.photographer_id as string,
    parentEmail: consumed.parent_email as string,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function loadPhotographer(
  service: ServiceClient,
  photographerId: string,
): Promise<ResolvedPhotographer | null> {
  const { data, error } = await service
    .from("photographers")
    .select("id, business_name, studio_email, billing_email, studio_phone")
    .eq("id", photographerId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    businessName: (data.business_name as string | null) ?? null,
    studioEmail: (data.studio_email as string | null) ?? null,
    billingEmail: (data.billing_email as string | null) ?? null,
    studioPhone: (data.studio_phone as string | null) ?? null,
  };
}

/**
 * Append a row to `pin_recovery_attempts` for audit + rate-limit purposes.
 * Caller picks the fields to log; failures should NEVER block the user-facing response.
 */
export async function logRecoveryAttempt(
  service: ServiceClient,
  args: {
    input: RecoveryRequestInput;
    studentId?: string | null;
    photographerId?: string | null;
    succeeded: boolean;
    failureReason?: DoorFailure | null;
  },
): Promise<void> {
  try {
    await service.from("pin_recovery_attempts").insert({
      ip_address: args.input.ipAddress,
      user_agent: args.input.userAgent,
      photographer_id: args.photographerId ?? null,
      student_id: args.studentId ?? null,
      email_tried: args.input.email.toLowerCase(),
      first_name_tried: args.input.firstName.toLowerCase(),
      last_name_tried: args.input.lastName.toLowerCase(),
      school_id_tried: args.input.schoolId ?? null,
      project_id_tried: args.input.projectId ?? null,
      succeeded: args.succeeded,
      failure_reason: args.failureReason ?? null,
    });
  } catch {
    // Never block the user-visible response if audit logging fails.
  }
}
