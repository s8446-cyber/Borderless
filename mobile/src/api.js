// API client. Talks to the real backend, or to the built-in simulator when
// CONFIG.DEMO_MODE is true (so the app runs standalone on a phone).
import { CONFIG } from "./config";
import { simulate } from "./demo";

let _token = null;
export function setToken(t) {
  _token = t;
}

async function real(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { "content-type": "application/json" };
  if (_token) headers.authorization = "Bearer " + _token;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(CONFIG.API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

export async function api(path, opts = {}) {
  return CONFIG.DEMO_MODE ? simulate(path, opts) : real(path, opts);
}
