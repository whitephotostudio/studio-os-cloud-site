"use client";
/** Local acceptance runner mounts this file temporarily; it is not a shipped page. */
import { Suspense, useEffect, useState } from "react";
import ParentGalleryPage from "@/components/parents/parent-gallery-client";
import { beginParentGallerySession, type ParentSessionAccess } from "@/lib/parent-gallery-session-client";

type FixtureParent = { kind: "school" | "event"; galleryId: string; pin: string; email: string; label: string };
export default function CollageEndToEndBrowser() {
  const [parents, setParents] = useState<FixtureParent[]>([]);
  const [access, setAccess] = useState<ParentSessionAccess>();
  const [error, setError] = useState("");
  async function open(parent: FixtureParent) {
    try { setAccess(await beginParentGallerySession({ kind: parent.kind, galleryId: parent.galleryId, pin: parent.pin, email: parent.email })); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  useEffect(() => {
    const original = window.fetch.bind(window);
    let fixtureOrigin = "";
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      if ((url.origin === window.location.origin || url.origin === fixtureOrigin) && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/collage-e2e/")) {
        const response = await original(`/api/collage-e2e${url.pathname}${url.search}`, init);
        if (url.pathname === "/api/stripe/checkout" && response.ok) {
          const payload = await response.json();
          const destination = new URL(payload.url);
          if (destination.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(destination.hostname)) throw Error("The acceptance payment must stay in the isolated fixture.");
          return Response.json({ ...payload, url: destination.toString() }, { status: response.status });
        }
        return response;
      }
      return original(input, init);
    };
    let alive = true;
    void original("/api/collage-e2e/__fixture/config").then(async response => {
      const config = await response.json();
      if (!response.ok) throw Error(config.message || "Start the isolated collage server first.");
      fixtureOrigin = new URL(config.baseUrl).origin;
      if (alive) { setParents(config.parents); await open(config.parents[0]); }
    }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; window.fetch = original; };
  }, []);
  return <>
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, fontSize: 10, pointerEvents: access ? "none" : "auto", zIndex: 100, background: "#f1f5f9", color: "#172033", padding: 3 }}>
      <strong>Isolated purchase-to-print acceptance · synthetic accounts/photos · simulated payments</strong>
      {!access && <div>{parents.map(parent => <button key={`${parent.kind}:${parent.pin}`} onClick={() => void open(parent)} style={{ margin: 2, padding: 2 }}>{parent.label}</button>)}</div>}
      {error && <p role="alert">{error}</p>}
    </div>
    {access && <Suspense fallback={<p>Opening private gallery…</p>}><ParentGalleryPage key={access.laneId} sessionAccess={access} /></Suspense>}
  </>;
}
