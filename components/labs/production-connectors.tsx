"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Download, KeyRound, Loader2, Monitor, RefreshCw } from "lucide-react";
import { productionFetch } from "./production-client";
import styles from "./production-connectors.module.css";

export type ProductionConnectorQueueAction = { action: "queue"; jobId: string; expectedVersion: number; requestId: string };
type Device = { id: string; name: string; targetLabel: string; createdAt: string; lastSeenAt: string | null; expiresAt: string; revokedAt: string | null };
type Target = { id: string; kind: "in_house" | "partner_lab"; label: string };
type Response = { ok: boolean; message?: string; devices?: Device[]; targets?: Target[]; pairCode?: string; expiresAt?: string; testOnly?: boolean; printAllowed?: boolean };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function productionConnectorDeviceState(device: Pick<Device, "revokedAt" | "expiresAt" | "lastSeenAt">, now = Date.now()): "revoked" | "expired" | "paired" | "waiting" {
  if (device.revokedAt) return "revoked";
  if (!Number.isFinite(Date.parse(device.expiresAt)) || Date.parse(device.expiresAt) <= now) return "expired";
  return device.lastSeenAt && Number.isFinite(Date.parse(device.lastSeenAt)) ? "paired" : "waiting";
}

export async function productionConnectorRequest(audience: "studio" | "lab", userId: string, body?: object, signal?: AbortSignal): Promise<Response> {
  const response = await productionFetch(`/api/dashboard/lab-connectors?audience=${audience}`, body, userId, signal), result = await response.json() as Response;
  if (!result.ok) throw new Error(result.message || "The test connector request could not be confirmed.");
  return result;
}

export function ProductionConnectorPanel({ audience, userId }: { audience: "studio" | "lab"; userId: string }) {
  const [devices, setDevices] = useState<Device[]>([]), [targets, setTargets] = useState<Target[]>([]), [targetKey, setTargetKey] = useState("");
  const [name, setName] = useState("Windows test helper"), [authorized, setAuthorized] = useState(false), [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [revokeId, setRevokeId] = useState("");
  const [setupOpen, setSetupOpen] = useState(false), [canCopy, setCanCopy] = useState(false), [copyNotice, setCopyNotice] = useState(""), [now, setNow] = useState(() => Date.now());
  const adopt = (result: Response) => {
    if (result.devices) setDevices(result.devices);
    if (result.targets) { setTargets(result.targets); setTargetKey(current => result.targets!.some(target => `${target.kind}:${target.id}` === current) ? current : result.targets![0] ? `${result.targets![0].kind}:${result.targets![0].id}` : ""); }
    setNow(Date.now());
  };
  useEffect(() => {
    const controller = new AbortController();
    productionConnectorRequest(audience, userId, undefined, controller.signal).then(result => { if (!controller.signal.aborted) adopt(result); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Test connector setup is unavailable."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [audience, userId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  async function refresh() {
    if (busy) return; setBusy(true); setError("");
    try { adopt(await productionConnectorRequest(audience, userId)); setNotice("PC list refreshed. Check each last-seen time below."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh test helpers."); }
    finally { setBusy(false); }
  }
  async function createPair() {
    const target = targets.find(value => `${value.kind}:${value.id}` === targetKey); if (busy || !target || !authorized || !name.trim()) return;
    setBusy(true); setError(""); setNotice(""); setPair(null); setCopyNotice("");
    setCanCopy(window.isSecureContext && typeof navigator.clipboard?.writeText === "function");
    try {
      const result = await productionConnectorRequest(audience, userId, { action: "create_pair", name: name.trim(), targetId: target.id, targetKind: target.kind });
      if (!result.pairCode || !result.expiresAt) throw new Error("The pairing response could not be confirmed. Refresh the setup before creating another code.");
      setPair({ code: result.pairCode, expiresAt: result.expiresAt }); adopt(result); setAuthorized(false); setSetupOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A private pairing code could not be created."); }
    finally { setBusy(false); }
  }
  async function copyCode() {
    if (!pair || Date.parse(pair.expiresAt) <= Date.now()) return;
    if (!window.isSecureContext || typeof navigator.clipboard?.writeText !== "function") { setCopyNotice("Select the code and copy it manually in this browser."); return; }
    try { await navigator.clipboard.writeText(pair.code); setCopyNotice("Code copied. Paste it only into your Windows test helper."); }
    catch { setCopyNotice("Copy was unavailable. Select the code and copy it manually."); }
  }
  async function revoke(deviceId: string) {
    if (busy) return; setBusy(true); setError("");
    try { adopt(await productionConnectorRequest(audience, userId, { action: "revoke", deviceId })); setRevokeId(""); setNotice("Test-helper access revoked. Pair a new helper to restore access."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The helper could not be revoked."); }
    finally { setBusy(false); }
  }
  const pairedCount = devices.filter(device => productionConnectorDeviceState(device, now) === "paired").length;
  const hasUsableDevice = pairedCount > 0, expiredCode = !!pair && Date.parse(pair.expiresAt) <= now;
  return <section className={styles.panel} aria-labelledby="production-connector-title">
    <header className={styles.header}><div><p className={styles.eyebrow}>ONE-TIME PC SETUP</p><h2 id="production-connector-title">Windows test helper</h2><p className={styles.intro}>Connect each PC once. Then stage reviewed jobs from your orders.</p></div><span className={styles.count}>{pairedCount ? `${pairedCount} paired ${pairedCount === 1 ? "PC" : "PCs"}` : "PC setup"}</span></header>
    <p className={styles.boundary}>Test only · Live GTA intake, payments and physical printing remain disabled.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.feedback} role="status">{notice}</p>}
    <details className={styles.setup} open={!hasUsableDevice || setupOpen} onToggle={event => { if (hasUsableDevice) setSetupOpen(event.currentTarget.open); }}>
      <summary onClick={event => { if (!hasUsableDevice) event.preventDefault(); }}><span>{hasUsableDevice ? "Setup guide · connect another PC" : "Connect a Windows PC in three steps"}</span>{hasUsableDevice && <ChevronDown size={17} aria-hidden="true" />}</summary>
      <ol className={styles.steps}>
        <li className={styles.step}><div className={styles.stepHeading}><span className={styles.number} aria-hidden="true">1</span><h3>Download</h3><Download size={17} aria-hidden="true" /></div><p>On the Windows PC, download and extract the ZIP.</p><a className={styles.secondary} href="/labs-pilot/connector-download" download><Download size={15} aria-hidden="true" />Download Windows test helper</a><p className={styles.hint}>Open <strong>Start-Studio-OS-Lab.cmd</strong> from the extracted folder. Keep the helper open.</p></li>
        <li className={styles.step}><div className={styles.stepHeading}><span className={styles.number} aria-hidden="true">2</span><h3>Create code</h3><KeyRound size={17} aria-hidden="true" /></div><form className={styles.form} onSubmit={event => { event.preventDefault(); void createPair(); }}><fieldset disabled={busy || loading}><label>Test destination<select value={targetKey} onChange={event => { setTargetKey(event.target.value); setAuthorized(false); }}>{targets.map(target => <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>{target.label}</option>)}</select></label><label>PC name<input maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><label className={styles.authorization}><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} /><span>I authorize this Windows test helper to retrieve reviewed test files for the selected destination.</span></label><button className={styles.primary} disabled={!targets.length || !name.trim() || !authorized}>{busy ? <Loader2 className={styles.spin} size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}Create private pairing code</button></fieldset></form>{!loading && !targets.length && <p className={styles.hint}>No destination is available for pairing under this account.</p>}
          {pair && <div className={styles.pair} aria-label="Private pairing code">{expiredCode ? <p className={styles.expired}>This code has expired. Create a new code to connect the PC.</p> : <><strong>Enter this code in the Windows test helper</strong><code className={styles.code}>{pair.code}</code><div className={styles.codeActions}>{canCopy && <button type="button" className={styles.secondary} onClick={() => void copyCode()}><Copy size={14} aria-hidden="true" />Copy code</button>}<button type="button" className={styles.textButton} onClick={() => { setPair(null); setCopyNotice(""); }}>Hide code</button></div><p className={styles.hint}>Expires {date(pair.expiresAt)}. Keep it private; it is only shown in this view.</p>{copyNotice && <p className={styles.feedback} role="status">{copyNotice}</p>}</>}</div>}
          <p className={styles.hint}>Codes expire after 10 minutes. Paired access expires after 90 days and can be revoked below.</p>
        </li>
        <li className={styles.step}><div className={styles.stepHeading}><span className={styles.number} aria-hidden="true">3</span><h3>Connect PC</h3><Monitor size={17} aria-hidden="true" /></div><p>Enter the code in the Windows helper and select <strong>Connect</strong>.</p><p>Return here and refresh the PC list to see its first last-seen time.</p><button className={styles.secondary} disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? styles.spin : ""} aria-hidden="true" />Check PC connection</button><p className={styles.hint}>The helper uses a separate review folder. File receipt is confirmed on each job, independently of the PC’s last-seen time.</p></li>
      </ol>
    </details>
    <section className={styles.devices} aria-labelledby="production-connected-pcs"><div className={styles.deviceHeading}><h3 id="production-connected-pcs">Your Windows PCs</h3><button className={styles.textButton} disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={13} className={busy ? styles.spin : ""} aria-hidden="true" />Refresh PC list</button></div>
      {loading ? <p className={styles.hint}>Loading paired PCs…</p> : devices.length ? <div className={styles.deviceList}>{devices.map(device => {
        const state = productionConnectorDeviceState(device, now), label = state === "revoked" ? "Access revoked" : state === "expired" ? "Access expired" : state === "waiting" ? "Waiting for PC" : "Paired";
        return <article className={styles.device} key={device.id}><div className={styles.deviceInfo}><div className={styles.deviceName}><Monitor size={17} aria-hidden="true" /><h3>{device.name}</h3><span className={styles.status} data-state={state}>{state === "paired" && <Check size={12} aria-hidden="true" />}{label}</span></div><p>{device.targetLabel}</p><p className={styles.hint}>Last seen: {device.lastSeenAt && Number.isFinite(Date.parse(device.lastSeenAt)) ? date(device.lastSeenAt) : "No connection recorded"}</p><p className={styles.hint}>{state === "expired" ? "Access expired" : "Access expires"} {date(device.expiresAt)}</p></div>{!device.revokedAt && <div className={styles.deviceAction}>{revokeId === device.id ? <div className={styles.revoke}><p>Revoke this PC’s access to test files?</p><div className={styles.codeActions}><button className={styles.secondary} disabled={busy} onClick={() => setRevokeId("")}>Keep access</button><button className={styles.textButton} disabled={busy} onClick={() => void revoke(device.id)}>Revoke helper</button></div></div> : <button className={styles.textButton} disabled={busy} onClick={() => setRevokeId(device.id)}>Revoke test access</button>}</div>}</article>;
      })}</div> : <p className={styles.hint}>No PCs are connected yet. Follow the three steps above.</p>}
      <p className={styles.receiptNote}>Last seen records a connection, not live availability or file delivery. Check the individual job’s handoff status to confirm receipt.</p>
    </section>
  </section>;
}
