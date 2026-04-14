import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/**
 * Creates a Supabase server client that can read/write cookies for session
 * management. This is needed for MFA operations which modify auth state.
 */
async function createAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — safe to ignore
          }
        },
      },
    },
  );
}

/**
 * GET /api/dashboard/mfa — List enrolled MFA factors for the current user
 */
export async function GET() {
  try {
    const supabase = await createAuthClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;

    const totpFactors = (data?.totp ?? []).map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? "Authenticator",
      status: f.status, // "verified" or "unverified"
      createdAt: f.created_at,
    }));

    return NextResponse.json({
      ok: true,
      factors: totpFactors,
      mfaEnabled: totpFactors.some((f) => f.status === "verified"),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to load MFA status.",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/dashboard/mfa — Enroll, verify, or unenroll an MFA factor
 *
 * Actions:
 *   { action: "enroll" }                          → Start TOTP enrollment, returns QR URI
 *   { action: "verify", factorId, code }          → Verify a factor with a 6-digit TOTP code
 *   { action: "unenroll", factorId }              → Remove a verified factor
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createAuthClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      factorId?: string;
      code?: string;
    };

    const action = (body.action ?? "").trim().toLowerCase();

    // ── Enroll: create a new TOTP factor ──────────────────────────────
    if (action === "enroll") {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });

      if (error) throw error;

      return NextResponse.json({
        ok: true,
        factorId: data.id,
        qrUri: data.totp.uri,
        secret: data.totp.secret,
      });
    }

    // ── Verify: confirm a factor with a TOTP code ─────────────────────
    if (action === "verify") {
      const factorId = (body.factorId ?? "").trim();
      const code = (body.code ?? "").trim();

      if (!factorId || !code) {
        return NextResponse.json(
          { ok: false, message: "Factor ID and verification code are required." },
          { status: 400 },
        );
      }

      if (!/^\d{6}$/.test(code)) {
        return NextResponse.json(
          { ok: false, message: "Please enter a 6-digit code." },
          { status: 400 },
        );
      }

      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });

      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });

      if (verifyError) {
        return NextResponse.json(
          { ok: false, message: "Invalid verification code. Please try again." },
          { status: 400 },
        );
      }

      return NextResponse.json({ ok: true, verified: true });
    }

    // ── Unenroll: remove a factor ─────────────────────────────────────
    if (action === "unenroll") {
      const factorId = (body.factorId ?? "").trim();
      if (!factorId) {
        return NextResponse.json(
          { ok: false, message: "Factor ID is required." },
          { status: 400 },
        );
      }

      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;

      return NextResponse.json({ ok: true, unenrolled: true });
    }

    return NextResponse.json(
      { ok: false, message: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "MFA operation failed.",
      },
      { status: 500 },
    );
  }
}
