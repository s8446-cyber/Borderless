// Public receipt verifier — recomputes a receipt's Merkle inclusion proof
// entirely client-side (Web Crypto). No login, no PII, no trust in the server
// for the math: the sibling path must hash up EXACTLY to the published anchor
// root or the verdict is a failure.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function step(text, cls) {
    $("steps").insertAdjacentHTML("beforeend",
      `<div class="step"><span class="${cls}">${cls === "ok" ? "✓" : "✗"}</span><span>${esc(text)}</span></div>`);
  }

  function verdict(pass, text) {
    $("result").innerHTML = `<div class="verdict ${pass ? "pass" : "fail"}">${pass ? "✓" : "✗"} ${esc(text)}</div>`;
  }

  async function verify() {
    $("steps").innerHTML = "";
    $("result").innerHTML = "";
    const idx = Number($("idx").value);
    const expected = $("hash").value.trim().toLowerCase();
    if (!Number.isInteger(idx) || idx < 1) return verdict(false, "Enter the settlement block index from the receipt (a whole number ≥ 1).");
    if (expected && !/^[0-9a-f]{64}$/.test(expected)) return verdict(false, "The settlement hash should be 64 hex characters — copy it exactly from the receipt.");

    let p;
    try {
      const res = await fetch("/api/ledger/proof/" + idx);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return verdict(false, e.error === "not_anchored" ? "Block " + idx + " does not exist or is not anchored yet." : "Could not fetch the proof (" + res.status + ").");
      }
      p = await res.json();
    } catch {
      return verdict(false, "Network error fetching the proof.");
    }
    step("Fetched Merkle proof for block " + idx + " (anchor " + p.anchor.anchorId + ", " + p.path.length + " path step" + (p.path.length === 1 ? "" : "s") + ")", "ok");

    if (expected) {
      if (p.blockHash !== expected) {
        step("Receipt hash does NOT match the ledger's block hash", "fail");
        return verdict(false, "MISMATCH: the ledger's block " + idx + " has a different hash than your receipt. This receipt is not committed at that index.");
      }
      step("Receipt hash matches the ledger block hash", "ok");
    }

    let h = p.blockHash;
    for (const s of p.path) {
      h = s.right ? await sha256Hex(h + s.hash) : await sha256Hex(s.hash + h);
    }
    if (h !== p.anchor.merkleRoot) {
      step("Recomputed root does NOT equal the published anchor root", "fail");
      return verdict(false, "PROOF INVALID: the sibling path does not reach the anchor's Merkle root.");
    }
    step("Recomputed root equals the published anchor root (client-side)", "ok");

    $("result").innerHTML =
      `<div class="verdict pass">✓ Verified — this settlement is committed under anchor ${esc(p.anchor.anchorId)}</div>` +
      `<div class="hashrow">Block hash: ${esc(p.blockHash)}</div>` +
      `<div class="hashrow">Anchor Merkle root: ${esc(p.anchor.merkleRoot)}</div>` +
      `<div class="hashrow">Published as: ${esc(p.anchor.publicTxHash)} · ${new Date(p.anchor.publishedAt).toLocaleString()}</div>`;
  }

  $("go").addEventListener("click", verify);
  $("hash").addEventListener("keydown", (e) => { if (e.key === "Enter") verify(); });

  // Deep links: /verify.html?index=42&hash=abc...
  const q = new URLSearchParams(location.search);
  if (q.get("index")) {
    $("idx").value = q.get("index");
    if (q.get("hash")) $("hash").value = q.get("hash");
    verify();
  }
})();
