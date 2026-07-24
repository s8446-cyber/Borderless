// Privacy center — self-serve DPDP rights on the web, without touching the
// main app bundle. Reuses this browser's remembered session (the same
// rotating, device-bound refresh token app.js persists). Rotating it here is
// exactly the multi-tab case app.js already handles: both always rotate the
// FRESHEST stored token and write the rotated pair back in place.
//
// Server contract (backend/src/dsr.js):
//   POST /api/account/export  { password }                      → export JSON
//   POST /api/account/profile { password, fullName?, country? } → correction
// Both require the CURRENT password (reauthentication) on top of the session
// — a stolen browser session alone can never exfiltrate the data file.

const SESSION_KEY = "bp_session_v1";

const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem("bp_device_id");
    if (!id) {
      id = "web-" + crypto.randomUUID();
      localStorage.setItem("bp_device_id", id);
    }
    return id;
  } catch {
    return "web-" + Math.random().toString(36).slice(2);
  }
})();

let token = null;

const $ = (id) => document.getElementById(id);

function say(el, msg, ok) {
  el.textContent = msg;
  el.className = "msg " + (ok ? "ok" : "err");
}

function loadRememberedSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return s && s.v === 1 && s.refreshToken ? s : null;
  } catch {
    return null;
  }
}

async function signIn() {
  const saved = loadRememberedSession();
  if (!saved) return { ok: false, reason: "no_session" };
  const r = await fetch("/api/sessions/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": DEVICE_ID },
    body: JSON.stringify({ refreshToken: saved.refreshToken, deviceId: DEVICE_ID }),
  }).catch(() => null);
  if (!r) return { ok: false, reason: "offline" };
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) return { ok: false, reason: "expired" };
  token = d.token;
  try {
    // Keep the persisted copy rotated in place, same shape app.js writes.
    localStorage.setItem(SESSION_KEY, JSON.stringify({ v: 1, refreshToken: d.refreshToken, name: saved.name || "" }));
  } catch {}
  return { ok: true };
}

async function api(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-id": DEVICE_ID,
      authorization: "Bearer " + token,
    },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.message || d.error || "Request failed");
    e.code = d.error;
    throw e;
  }
  return d;
}

async function onExport() {
  const pw = $("pw").value;
  const out = $("exportMsg");
  if (!pw) return say(out, "Enter your current password first.", false);
  say(out, "Preparing your export\u2026", true);
  try {
    const data = await api("/api/account/export", { password: pw });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "borderless-pay-export-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    say(out, "Export downloaded \u2014 it lists everything we hold about you (see the notes inside the file).", true);
  } catch (e) {
    say(out, e.message, false);
  }
}

async function onCorrect() {
  const pw = $("pw").value;
  const out = $("correctMsg");
  const fullName = $("fullName").value.trim();
  const country = $("country").value.trim();
  if (!pw) return say(out, "Enter your current password first.", false);
  if (!fullName && !country) return say(out, "Enter a new name and/or country.", false);
  say(out, "Updating\u2026", true);
  try {
    const body = { password: pw };
    if (fullName) body.fullName = fullName;
    if (country) body.country = country;
    const r = await api("/api/account/profile", body);
    say(
      out,
      r.updated && r.updated.length
        ? "Updated " + r.updated.join(" and ") + (r.kyc ? " \u2014 KYC re-checked: " + r.kyc.status : "")
        : "Nothing changed \u2014 your details already match.",
      true
    );
  } catch (e) {
    say(out, e.message, false);
  }
}

(async () => {
  const gate = $("gate");
  const panel = $("panel");
  const st = await signIn();
  if (!st.ok) {
    gate.hidden = false;
    panel.hidden = true;
    $("gateMsg").textContent =
      st.reason === "no_session"
        ? "No signed-in session on this browser. Open the app, sign in, then come back to this page."
        : st.reason === "offline"
          ? "You appear to be offline \u2014 reconnect and reload this page."
          : "Your session has expired \u2014 sign in again in the app, then reload this page.";
    return;
  }
  gate.hidden = true;
  panel.hidden = false;
  $("btnExport").addEventListener("click", onExport);
  $("btnCorrect").addEventListener("click", onCorrect);
})();
