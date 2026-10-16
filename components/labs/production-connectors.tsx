"use client";

import { useEffect, useState } from "react";
import { Download, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { productionFetch } from "./production-client";
import styles from "./production.module.css";

export type ProductionConnectorQueueAction = { action: "queue"; jobId: string; expectedVersion: number; requestId: string };
type Device = { id: string; name: string; targetLabel: string; createdAt: string; lastSeenAt: string | null; expiresAt: string; revokedAt: string | null };
type Target = { id: string; kind: "in_house" | "partner_lab"; label: string };
type Response = { ok: boolean; message?: string; devices?: Device[]; targets?: Target[]; pairCode?: string; expiresAt?: string; testOnly?: boolean; printAllowed?: boolean };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export async function productionConnectorRequest(audience: "studio" | "lab", userId: string, body?: object, signal?: AbortSignal): Promise<Response> {
  const response = await productionFetch(`/api/dashboard/lab-connectors?audience=${audience}`, body, userId, signal), result = await response.json() as Response;
  if (!result.ok) throw new Error(result.message || "The test connector request could not be confirmed.");
  return result;
}

export function ProductionConnectorPanel({ audience, userId }: { audience: "studio" | "lab"; userId: string }) {
  const [devices, setDevices] = useState<Device[]>([]), [targets, setTargets] = useState<Target[]>([]), [targetKey, setTargetKey] = useState("");
  const [name, setName] = useState("Windows test helper"), [authorized, setAuthorized] = useState(false), [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [revokeId, setRevokeId] = useState("");
  const adopt = (result: Response) => { if (result.devices) setDevices(result.devices); if (result.targets) { setTargets(result.targets); setTargetKey(current => result.targets!.some(target => `${target.kind}:${target.id}` === current) ? current : result.targets![0] ? `${result.targets![0].kind}:${result.targets![0].id}` : ""); } };
  useEffect(() => { const controller = new AbortController(); productionConnectorRequest(audience, userId, undefined, controller.signal).then(result => { if (!controller.signal.aborted) adopt(result); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Test connector setup is unavailable."); }); return () => controller.abort(); }, [audience, userId]);
  async function refresh() { setBusy(true); setError(""); try { adopt(await productionConnectorRequest(audience, userId)); setNotice("Latest test-helper status loaded."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh test helpers."); } finally { setBusy(false); } }
  async function createPair() {
    const target = targets.find(value => `${value.kind}:${value.id}` === targetKey); if (!target || !authorized || !name.trim()) return;
    setBusy(true); setError(""); setNotice(""); setPair(null);
    try {
      const result = await productionConnectorRequest(audience, userId, { action: "create_pair", name: name.trim(), targetId: target.id, targetKind: target.kind });
      if (!result.pairCode || !result.expiresAt) throw new Error("The pairing response could not be confirmed. Refresh the setup before creating another code.");
      setPair({ code: result.pairCode, expiresAt: result.expiresAt }); adopt(result); setAuthorized(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A private pairing code could not be created."); }
    finally { setBusy(false); }
  }
  async function revoke(deviceId: string) { setBusy(true); setError(""); try { adopt(await productionConnectorRequest(audience, userId, { action: "revoke", deviceId })); setRevokeId(""); setNotice("Test-helper access revoked. Pair a new helper to restore access."); } catch (cause) { setError(cause instanceof Error ? cause.message : "The helper could not be revoked."); } finally { setBusy(false); } }
  return <section className={styles.panel} style={{ marginTop: 24 }} aria-labelledby="production-connector-title"><div className={styles.sectionHead}><div><div className={styles.eyebrow}>GTA HANDOFF · TEST SETUP</div><h2 id="production-connector-title">Windows test helper</h2><p>Test a controlled download of reviewed paper files. Live GTA intake and physical printing remain disabled.</p></div><button className={styles.secondary} disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />Refresh helpers</button></div>
    <div className={styles.boundary}><ShieldCheck size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />A pairing grants this helper access to ready test files for the selected destination. Codes expire after 10 minutes. Paired access expires after 90 days and can be revoked here.</div>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    <div className={styles.grid}><form className={styles.form} onSubmit={event => { event.preventDefault(); void createPair(); }}><fieldset disabled={busy}><label>Test destination<select value={targetKey} onChange={event => setTargetKey(event.target.value)}>{targets.map(target => <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>{target.label}</option>)}</select></label><label>Helper name<input maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><label className={styles.check}><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} /><span>I authorize this Windows test helper to retrieve reviewed test files for the selected destination.</span></label><button className={styles.primary} disabled={!targets.length || !name.trim() || !authorized}>{busy ? <Loader2 className={styles.spin} size={14} /> : <KeyRound size={14} />}Create private pairing code</button></fieldset>{!targets.length && <p className={styles.muted}>No destination is available for pairing under this account.</p>}
      {pair && <div className={styles.notice} role="status" style={{ marginTop: 16 }}><strong>Enter this code in the Windows test helper</strong><p style={{ fontSize: 24, letterSpacing: 2, overflowWrap: "anywhere", margin: "10px 0" }}>{pair.code}</p><p>Expires {date(pair.expiresAt)}. Shown only in this view; keep it private.</p><button type="button" className={styles.quiet} onClick={() => setPair(null)}>Hide code</button></div>}
      <a className={styles.secondary} style={{ marginTop: 15 }} href="/labs-pilot/connector-download" download><Download size={14} />Download Windows test helper</a><p className={styles.muted} style={{ marginTop: 10 }}>Real catalog agreements, verified payments and printer setup are required before live lab production can be enabled.</p>
    </form><div className={styles.galleryList}>{devices.length ? devices.map(device => <article className={styles.card} key={device.id}><header><h3>{device.name}</h3><span className={styles.badge}>{device.revokedAt ? "Revoked" : "Test access"}</span></header><p>{device.targetLabel}</p><p className={styles.muted}>Last seen: {device.lastSeenAt ? date(device.lastSeenAt) : "Not connected yet"}</p><p className={styles.muted}>Access expires {date(device.expiresAt)}</p>{!device.revokedAt && (revokeId === device.id ? <div className={styles.notice}>Revoke this helper’s access to test files?<div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setRevokeId("")}>Keep access</button><button className={styles.secondary} disabled={busy} onClick={() => void revoke(device.id)}>Revoke helper</button></div></div> : <button className={styles.quiet} disabled={busy} onClick={() => setRevokeId(device.id)}>Revoke test access</button>)}</article>) : <p className={styles.muted}>No paired test helpers are listed for this account.</p>}</div></div>
  </section>;
}
