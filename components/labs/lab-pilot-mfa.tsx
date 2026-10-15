"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import styles from "./lab-pilot.module.css";

type PilotSession = { accessToken: string; email: string; userId: string };
type Factor = { id: string; friendlyName: string; status: string };
type Enrollment = { factorId: string; qrUri: string; secret: string };
type MfaResponse = Partial<Enrollment> & { ok?: boolean; message?: string; mfaEnabled?: boolean; factors?: Factor[]; verified?: boolean };
const SIGN_IN = "/sign-in?redirect=%2Flabs-pilot%23mfa";

/** Uses the existing settings MFA endpoint, without a photographer-profile gate. */
export function LabPilotMfa() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<PilotSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      setSession(data.session ? { accessToken: data.session.access_token, email: data.session.user.email ?? "Signed-in test account", userId: data.session.user.id } : null);
      if (sessionError) setError("Your session could not be loaded. Sign in with your supplied test account.");
      setReady(true);
    }).catch(() => {
      if (active) { setError("Your session could not be loaded. Sign in with your supplied test account."); setReady(true); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next ? { accessToken: next.access_token, email: next.user.email ?? "Signed-in test account", userId: next.user.id } : null);
      setReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [supabase]);

  if (!ready) return <p className={styles.status} role="status">Checking your test-account session…</p>;
  if (!session) return <>
    <p className={styles.status}>Sign in with the supplied lab test account to enroll an authenticator here. Credentials are provided separately.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.mfaActions}><Link className={styles.primary} href={SIGN_IN}>Sign in to set up lab security</Link></div>
  </>;
  return <PilotAccountMfa key={session.userId} session={session} supabase={supabase} />;
}

function PilotAccountMfa({ session, supabase }: { session: PilotSession; supabase: ReturnType<typeof createClient> }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusKnown, setStatusKnown] = useState(false);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const request = useCallback(async (body?: object) => {
    const response = await fetch("/api/dashboard/mfa", {
      method: body ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json() as MfaResponse;
    if (!response.ok || !result.ok) throw new Error(result.message || "Account security could not be loaded. Try again.");
    return result;
  }, [session.accessToken]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request();
      setEnabled(Boolean(result.mfaEnabled));
      setFactors(result.factors ?? []);
      setStatusKnown(true);
      if (result.mfaEnabled) { setEnrollment(null); setCode(""); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Account security could not be loaded.");
    } finally { setLoading(false); }
  }, [request]);

  useEffect(() => {
    let active = true;
    void request().then(result => {
      if (!active) return;
      setEnabled(Boolean(result.mfaEnabled));
      setFactors(result.factors ?? []);
      setStatusKnown(true);
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : "Account security could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  async function enroll() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await request({ action: "enroll" });
      if (!result.factorId || !result.qrUri || !result.secret) throw new Error("Enrollment could not be confirmed. Refresh security status before trying again.");
      setEnrollment({ factorId: result.factorId, qrUri: result.qrUri, secret: result.secret });
      setCode("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Enrollment could not be confirmed. Refresh security status before trying again.");
      await loadStatus();
    } finally { setBusy(false); }
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment || !/^\d{6}$/.test(code)) return;
    setBusy(true); setError("");
    try {
      await request({ action: "verify", factorId: enrollment.factorId, code });
      setEnrollment(null); setCode(""); setEnabled(true);
      setMessage("Authenticator enabled. Sign out and sign in again with this lab account and its current authenticator code, then open the lab portal.");
      await loadStatus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Verification could not be confirmed. Refresh security status to check before trying again.");
    } finally { setBusy(false); }
  }

  async function removeUnfinished(factorId: string) {
    setBusy(true); setError("");
    try {
      await request({ action: "unenroll", factorId });
      setMessage("Unfinished setup removed. You can start a new authenticator setup.");
      await loadStatus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The unfinished setup could not be removed. Refresh security status.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError("");
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      window.location.replace(SIGN_IN);
    } catch {
      setError("Sign-out could not be confirmed. Please try again before switching test accounts.");
      setBusy(false);
    }
  }

  return <div aria-busy={busy || loading}>
    <div className={styles.account}>
      <p><small>Current test account — confirm this is your lab login</small><strong>{session.email}</strong></p>
      <button className={styles.textButton} type="button" onClick={() => void signOut()} disabled={busy}>Sign out / switch account</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
    {loading && <p className={styles.status} role="status">Checking authenticator status…</p>}
    {enabled ? <>
      <p className={styles.success}><CheckCircle2 size={15} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px", marginRight: 5 }} /> An authenticator is enrolled for this account.</p>
      <p className={styles.status}>The lab portal requires a sign-in verified with your authenticator. If you have just enrolled or only entered your password, sign out here and sign in again to enter the current code.</p>
      <div className={styles.mfaActions}>
        <Link className={styles.primary} href="/lab">Open lab portal</Link>
        <button className={styles.outline} type="button" disabled={busy} onClick={() => void signOut()}>Sign out and sign in with a code</button>
      </div>
    </> : enrollment ? <div className={styles.enrollment}>
      <div className={styles.qr}><QRCodeSVG value={enrollment.qrUri} size={188} level="M" title="Scan this code with your own authenticator app" /></div>
      <form onSubmit={event => void verify(event)}>
        <p>Scan this QR code with your authenticator app, then enter its current six-digit code to finish setup.</p>
        <details className={styles.secret}><summary>Use a manual setup key instead</summary><code>{enrollment.secret}</code></details>
        <label className={styles.field} htmlFor="pilot-authenticator-code">Authenticator code</label>
        <input id="pilot-authenticator-code" className={styles.codeInput} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} aria-describedby="pilot-code-help" />
        <p id="pilot-code-help" className={styles.status}>Codes change regularly. Keep this page open until setup is confirmed.</p>
        <div className={styles.mfaActions}>
          <button className={styles.primary} type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify and enable authenticator"}</button>
          <button className={styles.outline} type="button" disabled={busy || loading} onClick={() => { setError(""); void loadStatus(); }}>Refresh security status</button>
        </div>
      </form>
    </div> : !loading && <>
      <p className={styles.status}>{statusKnown ? "An authenticator has not been verified for this account. Have your authenticator app ready before starting." : "Authenticator status could not be confirmed. Refresh security status before starting a new setup."}</p>
      {factors.filter(factor => factor.status === "unverified").map(factor => <div className={styles.account} key={factor.id}>
        <p>Unfinished authenticator setup. Remove it if you no longer have its QR code or setup key.</p>
        <button className={styles.textButton} type="button" disabled={busy} onClick={() => void removeUnfinished(factor.id)}>Remove unfinished setup</button>
      </div>)}
      <div className={styles.mfaActions}>
        <button className={styles.primary} type="button" disabled={busy || loading || !statusKnown || factors.some(factor => factor.status === "unverified")} onClick={() => void enroll()}><ShieldCheck size={16} aria-hidden="true" /> {busy ? "Starting setup…" : "Set up authenticator"}</button>
        <button className={styles.outline} type="button" disabled={busy || loading} onClick={() => { setError(""); void loadStatus(); }}>Refresh security status</button>
      </div>
    </>}
  </div>;
}
