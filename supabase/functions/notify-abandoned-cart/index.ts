// Desktop compatibility bridge. The website and scheduled sender use one
// atomic reminder policy; legacy force/cooldown options cannot bypass it.
const ENDPOINT = "https://www.studiooscloud.com/api/dashboard/orders/abandoned-cart-reminders";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function handleAbandonedCartBridge(req: Request, fetcher: typeof fetch = fetch) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s]+$/.test(authorization) || authorization.length > 8192) {
    return json({ ok: false, error: "Not authenticated." }, 401);
  }
  if (Number(req.headers.get("content-length") || 0) > 100_000) {
    return json({ ok: false, error: "Request too large." }, 413);
  }
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.orderIds) || body.orderIds.length < 1 || body.orderIds.length > 1000 ||
    !body.orderIds.every((id: unknown) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    return json({ ok: false, error: "Provide 1 to 1000 valid orderIds." }, 400);
  }
  try {
    // Send the caller's existing JWT, never a service-role key. The receiving
    // route validates identity, MFA, subscription and every order's owner.
    const response = await fetcher(ENDPOINT, {
      method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds: body.orderIds }),
      redirect: "error", signal: AbortSignal.timeout(55_000),
    });
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== "object") return json({ ok: false, error: "Reminder service unavailable." }, 503);
    return json(result, response.status);
  } catch {
    // Claims retain uncertain provider outcomes; repeated clicks cannot
    // create an unbounded second sequence or blindly resend a stage.
    return json({ ok: false, error: "Reminder service unavailable. Please check the current result before retrying." }, 503);
  }
}

Deno.serve((request: Request) => handleAbandonedCartBridge(request));
