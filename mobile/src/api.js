// API client. Talks to the real backend, or to the built-in simulator when
// CONFIG.DEMO_MODE is true (so the app runs standalone on a phone).
//
// Hardening (G-3/G-6):
//  - every request presents the keystore-backed device ID (x-device-id); the
//    session issued at KYC is bound to it server-side
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
import { simulate, exportDemoState } from "./demo";
import { getDeviceId } from "./device";
import { updateStoredTokens, clearPersistedSession } from "./session";
import { saveDoc } from "./storage";

let _token = null;
let _refresh = null;
let _onSessionExpired = null;

export function setToken(t) {
  _token = t;
}

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
      await updateStoredTokens(_token, _refresh).catch(() => {});
      ({ res, data } = await request(path, opts));
    } else if (r.res.status === 401) {
      // the refresh token itself is dead — this session cannot be saved
      await expireSession();
      throw new Error("Your session has expired — please sign in again.");
    }
  } else if (res.status === 401 && !_refresh && _token && path !== "/api/logout") {
    await expireSession();
    throw new Error("Your session has expired — please sign in again.");
  }
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

// ---- demo-mode persistence ----
// Every simulated call may mutate the demo db (payments, lockout counters,
// even logout), so the state is flushed to the device's private storage after
// each one — debounced so a burst of calls writes once.
export const DEMO_STATE_DOC = "bp-demo-state.json";
let _persistTimer = null;

function schedulePersistDemo() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    saveDoc(DEMO_STATE_DOC, JSON.stringify(exportDemoState())).catch(() => {});
  }, 400);
}

export async function api(path, opts = {}) {
  if (!CONFIG.DEMO_MODE) return real(path, opts);
  try {
    return await simulate(path, opts);
  } finally {
    schedulePersistDemo(); // errors mutate too (wrong-PIN counters, lockouts)
  }
}
