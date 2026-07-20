// Persisted auth session (live-backend mode) so a returning user unlocks the
// app instead of redoing KYC — the way every professional payments app works.
//
// What is stored (OS keystore/keychain via storage.js secure tier):
//   { v, token, refreshToken, name, onboarded: "link" | "home" }
// "onboarded" resumes an interrupted first run: killed after KYC but before
// linking a bank → next launch lands back on the link step, not on KYC.
//
// Tokens still never touch disk outside the keystore, and clearing is
// guaranteed on logout / account closure / refresh-token death.
import { saveSecure, loadSecure, deleteSecure } from "./storage";

const KEY = "bp_session_v1";

export async function persistSession({ token, refreshToken, name, onboarded }) {
  try {
    await saveSecure(KEY, JSON.stringify({ v: 1, token, refreshToken, name, onboarded }));
  } catch {
    /* keystore unavailable — session stays memory-only, app still works */
  }
}

export async function loadPersistedSession() {
  try {
    const raw = await loadSecure(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.v !== 1 || !s.token || !s.refreshToken) return null;
    return s;
  } catch {
    return null;
  }
}

// Rotate stored tokens in place after a silent session refresh — but only if
// a session was persisted in the first place (respects memory-only mode).
export async function updateStoredTokens(token, refreshToken) {
  const s = await loadPersistedSession();
  if (!s) return;
  await persistSession({ ...s, token, refreshToken });
}

export async function markOnboarded(onboarded) {
  const s = await loadPersistedSession();
  if (!s) return;
  await persistSession({ ...s, onboarded });
}

// Refresh the cached profile facts (display name, onboarding stage) from the
// server's answer. The cache exists ONLY as an offline fallback — routing
// decisions are always made from /api/me when the network is up.
export async function rememberProfile({ name, onboarded } = {}) {
  const s = await loadPersistedSession();
  if (!s) return;
  await persistSession({
    ...s,
    name: name !== undefined && name !== null ? name : s.name,
    onboarded: onboarded || s.onboarded,
  });
}

export async function clearPersistedSession() {
  await deleteSecure(KEY);
}
