// Apple Push Notification service (APNs) — token-based (.p8) sender.
//
// No third-party SDK and no extra npm dependency: the ES256 JWT is signed with
// Node's built-in crypto (`dsaEncoding: "ieee-p1363"` yields the raw R||S
// signature JWT requires), and the push is delivered over Node's http2 to
// Apple's HTTP/2 endpoint.
//
// IMPORTANT: `node:crypto` and `node:http2` are loaded lazily (with the
// `turbopackIgnore` magic comment) instead of imported at the top of the file.
// This module is reached from `lib/payments.ts`, which a few dashboard *client*
// components import for pure billing helpers. A static `import ... "node:http2"`
// would get pulled into the client bundle and break the Turbopack build
// ("the chunking context does not support external modules (request:
// node:http2)"). Loading them inside the function keeps this module free of any
// static `node:` external; these functions only ever run on the server, where
// the imports resolve normally.
//
// Required env vars (set in Vercel):
//   APNS_KEY_ID       – the Key ID of your APNs Auth Key (.p8)
//   APNS_TEAM_ID      – your Apple Developer Team ID
//   APNS_PRIVATE_KEY  – the .p8 contents (PKCS#8 PEM; newlines as \n)
//   APNS_BUNDLE_ID    – com.studiooscloud.mobile
//   APNS_PRODUCTION   – "true" for the App Store/TestFlight, else sandbox

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

type CryptoModule = typeof import("node:crypto");
type Http2Module = typeof import("node:http2");

async function loadNodeModules(): Promise<{
  crypto: CryptoModule;
  http2: Http2Module;
}> {
  const [cryptoMod, http2Mod] = await Promise.all([
    import(/* turbopackIgnore: true */ "node:crypto"),
    import(/* turbopackIgnore: true */ "node:http2"),
  ]);
  const crypto = ((cryptoMod as { default?: CryptoModule }).default ??
    cryptoMod) as CryptoModule;
  const http2 = ((http2Mod as { default?: Http2Module }).default ??
    http2Mod) as Http2Module;
  return { crypto, http2 };
}

// APNs JWTs are valid up to 1h and Apple throttles regenerating them, so cache.
let cachedJwt: { value: string; at: number } | null = null;

function apnsJwt(crypto: CryptoModule): string {
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

const APNS_PRODUCTION_HOST = "https://api.push.apple.com";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";

/** Send to one specific APNs gateway. */
function sendToHost(
  http2: Http2Module,
  host: string,
  deviceToken: string,
  bundleId: string,
  jwt: string,
  body: Buffer,
): Promise<ApnsResult> {
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

/** Deliver one alert payload to one device token. Resolves with the APNs
 *  status so the caller can prune dead tokens (410 / BadDeviceToken).
 *
 *  A device token is tied to one APNs environment: dev/Xcode builds register a
 *  sandbox token, TestFlight/App Store builds register a production token. We
 *  try the gateway implied by APNS_PRODUCTION first, then fall back to the other
 *  on "BadDeviceToken" — so push works for both build types without juggling the
 *  env var, and the caller only prunes a token that's dead on *both*. */
export async function sendApnsPush(
  deviceToken: string,
  payload: Record<string, unknown>,
): Promise<ApnsResult> {
  if (!hasApnsConfig()) return { ok: false, status: 0, reason: "not-configured" };

  const bundleId = env("APNS_BUNDLE_ID");
  const preferProduction = env("APNS_PRODUCTION") === "true";
  const primaryHost = preferProduction ? APNS_PRODUCTION_HOST : APNS_SANDBOX_HOST;
  const fallbackHost = preferProduction ? APNS_SANDBOX_HOST : APNS_PRODUCTION_HOST;

  let crypto: CryptoModule;
  let http2: Http2Module;
  try {
    ({ crypto, http2 } = await loadNodeModules());
  } catch (error) {
    console.error("[apns] failed to load node modules", error);
    return { ok: false, status: 0, reason: "node-load" };
  }

  let jwt: string;
  try {
    jwt = apnsJwt(crypto);
  } catch (error) {
    console.error("[apns] failed to sign JWT", error);
    return { ok: false, status: 0, reason: "jwt" };
  }

  const body = Buffer.from(JSON.stringify(payload));

  let result = await sendToHost(http2, primaryHost, deviceToken, bundleId, jwt, body);
  // Token belongs to the other environment → Apple says BadDeviceToken. Retry.
  if (!result.ok && result.reason === "BadDeviceToken") {
    result = await sendToHost(http2, fallbackHost, deviceToken, bundleId, jwt, body);
  }
  return result;
}
