// Apple Push Notification service (APNs) — token-based (.p8) sender.
//
// No third-party SDK and no extra npm dependency: the ES256 JWT is signed with
// Node's built-in crypto (`dsaEncoding: "ieee-p1363"` yields the raw R||S
// signature JWT requires), and the push is delivered over Node's http2 to
// Apple's HTTP/2 endpoint.
//
// Required env vars (set in Vercel):
//   APNS_KEY_ID       – the Key ID of your APNs Auth Key (.p8)
//   APNS_TEAM_ID      – your Apple Developer Team ID
//   APNS_PRIVATE_KEY  – the .p8 contents (PKCS#8 PEM; newlines as \n)
//   APNS_BUNDLE_ID    – com.studiooscloud.mobile
//   APNS_PRODUCTION   – "true" for the App Store/TestFlight, else sandbox

import crypto from "node:crypto";
import http2 from "node:http2";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function hasApnsConfig(): boolean {
  return Boolean(
    env("APNS_KEY_ID") &&
      env("APNS_TEAM_ID") &&
      env("APNS_PRIVATE_KEY") &&
      env("APNS_BUNDLE_ID"),
  );
}

// APNs JWTs are valid up to 1h and Apple throttles regenerating them, so cache.
let cachedJwt: { value: string; at: number } | null = null;

function apnsJwt(): string {
  if (cachedJwt && Date.now() - cachedJwt.at < 50 * 60 * 1000) {
    return cachedJwt.value;
  }
  const keyId = env("APNS_KEY_ID");
  const teamId = env("APNS_TEAM_ID");
  const privateKey = env("APNS_PRIVATE_KEY").replace(/\\n/g, "\n");

  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: keyId }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .sign("sha256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    })
    .toString("base64url");

  const value = `${signingInput}.${signature}`;
  cachedJwt = { value, at: Date.now() };
  return value;
}

export type ApnsResult = { ok: boolean; status: number; reason?: string };

/** Deliver one alert payload to one device token. Resolves with the APNs
 *  status so the caller can prune dead tokens (410 / BadDeviceToken). */
export async function sendApnsPush(
  deviceToken: string,
  payload: Record<string, unknown>,
): Promise<ApnsResult> {
  if (!hasApnsConfig()) return { ok: false, status: 0, reason: "not-configured" };

  const host =
    env("APNS_PRODUCTION") === "true"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  const bundleId = env("APNS_BUNDLE_ID");

  let jwt: string;
  try {
    jwt = apnsJwt();
  } catch (error) {
    console.error("[apns] failed to sign JWT", error);
    return { ok: false, status: 0, reason: "jwt" };
  }

  return new Promise<ApnsResult>((resolve) => {
    const client = http2.connect(host);
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    client.on("error", () => finish({ ok: false, status: 0, reason: "connection" }));

    const body = Buffer.from(JSON.stringify(payload));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      authorization: `bearer ${jwt}`,
      "content-type": "application/json",
      "content-length": body.length,
    });

    let status = 0;
    let data = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      let reason: string | undefined;
      if (status !== 200 && data) {
        try {
          reason = (JSON.parse(data) as { reason?: string }).reason;
        } catch {
          /* non-JSON error body */
        }
      }
      finish({ ok: status === 200, status, reason });
    });
    req.on("error", () => finish({ ok: false, status: 0, reason: "request" }));
    req.write(body);
    req.end();
  });
}
