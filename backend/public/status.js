// Live status page. Polls the public, PII-free observability endpoints:
//   /api/health  liveness
//   /api/ready   readiness + full ledger & audit integrity re-verification
//   /api/meta    settlement mode + policy versions (honest-mode disclosure)
// CSP: script-src 'self' — this file must stay external (no inline JS).
"use strict";

const REFRESH_MS = 30000;

function row(id) {
  return document.getElementById(id);
}

function setState(id, state, detail) {
  const el = row(id);
  if (!el) return;
  const dot = el.querySelector(".dot");
  const txt = el.querySelector(".detail");
  dot.className = "dot " + state; // ok | bad | warn | unknown
  txt.textContent = detail;
}

async function probe(path) {
  const t0 = performance.now();
  try {
    const res = await fetch(path, { cache: "no-store" });
    const ms = Math.round(performance.now() - t0);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, ms, data };
  } catch {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), data: null };
  }
}

async function refresh() {
  const [health, ready, meta] = await Promise.all([
    probe("/api/health"),
    probe("/api/ready"),
    probe("/api/meta"),
  ]);

  if (health.ok && health.data && health.data.ok) {
    setState("row-api", "ok", "Operational — " + health.ms + " ms");
  } else if (health.status === 0) {
    setState("row-api", "bad", "Unreachable");
  } else {
    setState("row-api", "bad", "HTTP " + health.status);
  }

  if (ready.ok && ready.data && ready.data.ready) {
    const l = ready.data.ledger || {};
    const a = ready.data.audit || {};
    setState("row-ledger", l.ok ? "ok" : "bad", l.ok ? "Hash chain verified" : "INTEGRITY CHECK FAILED");
    setState("row-audit", a.ok ? "ok" : "bad", a.ok ? "Hash chain verified" : "INTEGRITY CHECK FAILED");
  } else if (ready.status === 503) {
    setState("row-ledger", "bad", "INTEGRITY CHECK FAILED (service not ready)");
    setState("row-audit", "bad", "INTEGRITY CHECK FAILED (service not ready)");
  } else {
    setState("row-ledger", "unknown", "Unknown — readiness endpoint unreachable");
    setState("row-audit", "unknown", "Unknown — readiness endpoint unreachable");
  }

  if (meta.ok && meta.data && meta.data.settlementMode) {
    const live = meta.data.settlementMode === "live";
    setState("row-mode", live ? "ok" : "warn",
      live ? "LIVE — real money movement"
           : "SANDBOX — money movement is simulated and disclosed on every receipt");
  } else {
    setState("row-mode", "unknown", "Unknown");
  }

  const overallOk = health.ok && ready.ok;
  const banner = document.getElementById("overall");
  banner.textContent = overallOk ? "All systems operational" : "Service degraded — see checks below";
  banner.className = "overall " + (overallOk ? "ok" : "bad");
  document.getElementById("updated").textContent =
    "Last checked " + new Date().toLocaleTimeString() + " · auto-refreshes every 30s";
}

refresh();
setInterval(refresh, REFRESH_MS);
