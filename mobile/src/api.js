// API client — talks to the real backend, always.
//
// Hardening (G-3/G-6):
//  - every request presents the keystore-backed device ID (x-device-id); the
//    session issued at sign-up is bound to it server-side
//  - tokens live in memory while running; a persisted copy sits ONLY in the
//    OS keystore/keychain (src/session.js) so a relaunch unlocks instead of
//    re-onboarding — the professional-app behavior
//  - silent session renewal: an expired session is refreshed ONCE via the
//    rotating refresh token, then the original call is retried; the rotated
//    pair replaces the keystore copy
//  - a dead refresh token (expired / revoked / reuse-detected) triggers the
//    registered onSessionExpired handler exactly once, so the UI can return
//    the user to a clean sign-in instead of stranding them on failing screens
import { CONFIG } from "./config";
import { getDeviceId } from "./device";
import { updateStoredTokens, clearPersistedSession } from "./session";
import { singleFlight } from "./singleflight";

let _token = null;
let _refresh = null;
let _onSessionExpired = null;

export function setSession({ token, refreshToken } = {}) {
  _token = token || null;
  _refresh = refreshToken || null;
}

export function hasSession() {
  return Boolean(_token);
}

// UI hook: called once when the session can no longer be renewed.
export function onSessionExpired(cb) {
  _onSessionExpired = cb;
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

async function expireSession() {
  setSession({});
  await clearPersistedSession().catch(() => {});
  if (_onSessionExpired) {
    const cb = _onSessionExpired;
    _onSessionExpired = null; // fire once; App re-registers on next sign-in
    cb();
  }
}

// Renew the session via the rotating refresh token. SINGLE-FLIGHT: the
// refresh token is single-use (rotation with reuse detection), so parallel
// 401s — e.g. the unlock-time background refresh racing an Activity tap —
// must share ONE renewal. The loser of a duplicate race would present an
// already-rotated token, which the server rightly treats as theft and
// answers by revoking every session for the account.
const renewSession = singleFlight(async () => {
  if (!_refresh) return { ok: false, status: 0 };
  try {
    const r = await request("/api/sessions/refresh", {
      method: "POST",
      body: { refreshToken: _refresh, deviceId: await getDeviceId() },
    });
    if (r.res.ok) {
      _token = r.data.token;
      _refresh = r.data.refreshToken;
      await updateStoredTokens(_token, _refresh).catch(() => {});
      return { ok: true };
    }
    return { ok: false, status: r.res.status };
  } catch {
    return { ok: false, status: 0 }; // network error — no verdict on the token
  }
});

export async function api(path, opts = {}) {
  let { res, data } = await request(path, opts);
  if (res.status === 401 && _refresh && (data.error === "session_expired" || data.error === "unauthorized")) {
    const renewed = await renewSession();
    if (renewed.ok) {
      ({ res, data } = await request(path, opts));
    } else if (renewed.status === 401) {
      // the refresh token itself is dead — this session cannot be saved
      await expireSession();
      throw new Error("Your session has expired — please sign in again.");
    }
    // network failure during renewal → fall through to the original error
  } else if (res.status === 401 && !_refresh && _token && path !== "/api/logout") {
    await expireSession();
    throw new Error("Your session has expired — please sign in again.");
  }
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}
