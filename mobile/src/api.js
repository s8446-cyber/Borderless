// API client. Talks to the real backend, or to the built-in simulator when
// CONFIG.DEMO_MODE is true (so the app runs standalone on a phone).
//
// Hardening (G-3/G-6):
//  - every request presents the keystore-backed device ID (x-device-id); the
//    session issued at KYC is bound to it server-side
//  - tokens live in memory only (never written to disk)
//  - silent session renewal: an expired session is refreshed ONCE via the
//    rotating refresh token, then the original call is retried
import { CONFIG } from "./config";
import { simulate } from "./demo";
import { getDeviceId } from "./device";

let _token = null;
let _refresh = null;

export function setToken(t) {
  _token = t;
}

export function setSession({ token, refreshToken } = {}) {
  _token = token || null;
  _refresh = refreshToken || null;
}

async function request(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { "content-type": "application/json", "x-device-id": await getDeviceId() };
  if (_token) headers.authorization = "Bearer " + _token;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(CONFIG.API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function real(path, opts = {}) {
  let { res, data } = await request(path, opts);
  if (res.status === 401 && _refresh && (data.error === "session_expired" || data.error === "unauthorized")) {
    const r = await request("/api/sessions/refresh", {
      method: "POST",
      body: { refreshToken: _refresh, deviceId: await getDeviceId() },
    });
    if (r.res.ok) {
      _token = r.data.token;
      _refresh = r.data.refreshToken;
      ({ res, data } = await request(path, opts));
    }
  }
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

export async function api(path, opts = {}) {
  return CONFIG.DEMO_MODE ? simulate(path, opts) : real(path, opts);
}
