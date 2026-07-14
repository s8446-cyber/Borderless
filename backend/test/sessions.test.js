// Session & anchor hardening regression tests (G-3, G-4):
//   G-3 — device-bound sessions, refresh-token rotation with reuse detection
//         (theft signal → revoke everything), and revoke-all ("log out
//         everywhere"). All backward compatible: sessions created without a
//         deviceId behave exactly as before.
//   G-4 — Merkle inclusion proofs: any third party can verify that a receipt's
//         settlement block is committed under a published anchor using only
//         hashes (no login, no transaction contents). Anchor publishing is
//         pluggable for the real public-chain writer.
import test from "node:test";
import assert from "node:assert/strict";

import { DualLedger, merkleRoot, merkleProof, verifyMerkleProof, sha256 } from "../src/ledger.js";
import { buildApp } from "../src/server.js";

// ---------- G-4: Merkle proofs (pure math) ----------

test("G-4: merkleProof verifies for every leaf, including odd-sized trees", () => {
  for (const n of [1, 2, 3, 5, 8, 13]) {
    const leaves = Array.from({ length: n }, (_, i) => sha256("leaf" + i));
    const root = merkleRoot(leaves);
    for (let i = 0; i < n; i++) {
      const path = merkleProof(leaves, i);
      assert.ok(verifyMerkleProof(leaves[i], path, root), `n=${n} i=${i} verifies`);
      // a different leaf must NOT verify with this path
      assert.ok(!verifyMerkleProof(sha256("evil"), path, root), `n=${n} i=${i} rejects forgery`);
    }
  }
  assert.equal(merkleProof([sha256("a")], 5), null, "out-of-range index");
});

test("G-4: ledger.proof() rolls a block up to its published anchor", () => {
  const l = new DualLedger({ anchorEvery: 3 });
  for (let i = 0; i < 6; i++) {
    l.append({ type: "settlement", paymentId: "p" + i, legs: [
      { account: "user:u1", deltaMinor: -100 },
      { account: "clearing:x", deltaMinor: 100 },
    ] });
  }
  // blocks 1..3 under anchor 0, blocks 4..6 under anchor 1
  for (const idx of [1, 2, 3, 4, 5, 6]) {
    const p = l.proof(idx);
    assert.ok(p, `block ${idx} has a proof`);
    assert.equal(p.blockHash, l.blocks[idx].hash);
    assert.ok(verifyMerkleProof(p.blockHash, p.path, p.anchor.merkleRoot), `block ${idx} verifies to anchor root`);
    assert.ok(p.anchor.publicTxHash.startsWith("0x"));
  }
  assert.equal(l.proof(0), null, "genesis is never anchored");
  assert.equal(l.proof(999), null, "unknown block");
});

test("G-4: anchor publisher is pluggable (real chain writer drop-in)", () => {
  const calls = [];
  const l = new DualLedger({ anchorEvery: 2 }, {
    publisher: ({ fromIndex, toIndex, merkleRoot: root }) => {
      calls.push({ fromIndex, toIndex, root });
      return "0xreal_chain_tx_" + calls.length;
    },
  });
  l.append({ type: "settlement", paymentId: "p1" });
  const { anchor } = l.append({ type: "settlement", paymentId: "p2" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fromIndex, 1);
  assert.equal(calls[0].toIndex, 2);
  assert.equal(calls[0].root, anchor.merkleRoot);
  assert.equal(anchor.publicTxHash, "0xreal_chain_tx_1");
  assert.equal(l.verify().ok, true);
});

// ---------- HTTP harness ----------

async function withServer(fn) {
  const app = buildApp({ dbPath: null });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, { method = "GET", body, token, deviceId } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    if (deviceId) headers["x-device-id"] = deviceId;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  try {
    await fn({ call, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

const KYC = (extra = {}) => ({ method: "POST", body: { fullName: "Aarav Shah", documentId: "P1", country: "IN", consent: true, ...extra } });

// ---------- G-3: device binding ----------

test("G-3: device-bound session rejects requests from another device", async () => {
  await withServer(async ({ call }) => {
    const r = await call("/api/kyc/verify", KYC({ deviceId: "pixel-8-abc123" }));
    assert.equal(r.status, 200);
    assert.ok(r.data.refreshToken, "refresh token issued");
    const token = r.data.token;

    // correct device → works
    let a = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token, deviceId: "pixel-8-abc123" });
    assert.equal(a.status, 200);

    // missing / wrong device → 401, no data
    a = await call("/api/accounts", { token });
    assert.equal(a.status, 401);
    assert.equal(a.data.error, "device_mismatch");
    a = await call("/api/accounts", { token, deviceId: "attacker-device" });
    assert.equal(a.status, 401);

    // sessions created WITHOUT a deviceId keep the old behavior
    const legacy = await call("/api/kyc/verify", KYC());
    const t2 = legacy.data.token;
    const ok = await call("/api/accounts/link", { method: "POST", body: { bank: "SBI", pin: "1111" }, token: t2 });
    assert.equal(ok.status, 200);
  });
});

// ---------- G-3: refresh rotation + reuse detection ----------

test("G-3: refresh rotates tokens; reusing a rotated token revokes everything", async () => {
  await withServer(async ({ call, app }) => {
    const r = await call("/api/kyc/verify", KYC({ deviceId: "dev-1" }));
    const rt1 = r.data.refreshToken;

    // rotate: old refresh retired, new pair issued
    let ref = await call("/api/sessions/refresh", { method: "POST", body: { refreshToken: rt1, deviceId: "dev-1" } });
    assert.equal(ref.status, 200);
    const { token: tok2, refreshToken: rt2 } = ref.data;
    assert.ok(tok2 && rt2 && rt2 !== rt1);

    // the new access token works (with the bound device)
    const ok = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token: tok2, deviceId: "dev-1" });
    assert.equal(ok.status, 200);

    // REUSE of the rotated rt1 → theft signal → all sessions revoked
    ref = await call("/api/sessions/refresh", { method: "POST", body: { refreshToken: rt1, deviceId: "dev-1" } });
    assert.equal(ref.status, 401);
    assert.equal(ref.data.error, "refresh_reused");

    // tok2 and rt2 are dead too
    const after = await call("/api/accounts", { token: tok2, deviceId: "dev-1" });
    assert.equal(after.status, 401);
    assert.equal(app.store.data.refresh[rt2], undefined, "successor refresh revoked");
  });
});

test("G-3: refresh is device-bound and expiry is enforced", async () => {
  await withServer(async ({ call, app }) => {
    const r = await call("/api/kyc/verify", KYC({ deviceId: "dev-A" }));
    const rt = r.data.refreshToken;

    // wrong device → rejected
    let ref = await call("/api/sessions/refresh", { method: "POST", body: { refreshToken: rt, deviceId: "dev-B" } });
    assert.equal(ref.status, 401);
    assert.equal(ref.data.error, "device_mismatch");

    // expired → rejected and deleted
    app.store.data.refresh[rt].exp = Date.now() - 1;
    ref = await call("/api/sessions/refresh", { method: "POST", body: { refreshToken: rt, deviceId: "dev-A" } });
    assert.equal(ref.status, 401);
    assert.equal(ref.data.error, "refresh_expired");
    assert.equal(app.store.data.refresh[rt], undefined);

    // unknown token
    ref = await call("/api/sessions/refresh", { method: "POST", body: { refreshToken: "rtk_bogus" } });
    assert.equal(ref.status, 401);
  });
});

// ---------- G-3: revoke-all ----------

test("G-3: revoke-all kills every session and refresh token for the user", async () => {
  await withServer(async ({ call, app }) => {
    // two "devices" logged in — simulate by two KYC sessions for the same human
    const r1 = await call("/api/kyc/verify", KYC());
    const tok1 = r1.data.token;
    // second session for the SAME user via refresh
    const ref = await call("/api/sessions/refresh", { method: "POST", body: { refreshToken: r1.data.refreshToken } });
    const tok2 = ref.data.token;

    let out = await call("/api/sessions/revoke-all", { method: "POST", token: tok1 });
    assert.equal(out.status, 200);
    assert.ok(out.data.revoked >= 2);

    for (const t of [tok1, tok2]) {
      const a = await call("/api/accounts", { token: t });
      assert.equal(a.status, 401, "all access tokens dead");
    }
    const userId = r1.data.userId;
    const liveRefresh = Object.values(app.store.data.refresh).filter((x) => x.userId === userId);
    assert.equal(liveRefresh.length, 0, "all refresh tokens dead");
  });
});

// ---------- G-3: sweep covers refresh tokens ----------

test("G-3: maintenance sweep garbage-collects expired refresh tokens", async () => {
  await withServer(async ({ call, app }) => {
    const r = await call("/api/kyc/verify", KYC());
    const rt = r.data.refreshToken;
    app.store.data.refresh[rt].exp = Date.now() - 1;
    const swept = app.sweepExpired();
    assert.equal(swept.refresh, 1);
    assert.equal(app.store.data.refresh[rt], undefined);
  });
});

// ---------- G-4: public proof endpoint over HTTP ----------

test("G-4: /api/ledger/proof/:index lets a third party verify a receipt", async () => {
  await withServer(async ({ call }) => {
    const r = await call("/api/kyc/verify", KYC());
    const token = r.data.token;
    await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token });

    const q = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 80 } });
    const pay = await call("/api/payments", { method: "POST", body: { quoteId: q.data.quoteId, pin: "4321" }, token });
    assert.equal(pay.status, 200);
    const settlement = pay.data.receipt.settlement; // { index, hash } — printed on the receipt

    // UNAUTHENTICATED proof fetch (public verification, zero PII)
    const proof = await call(`/api/ledger/proof/${settlement.index}`);
    assert.equal(proof.status, 200);
    assert.equal(proof.data.blockHash, settlement.hash, "proof matches the receipt's settlement hash");
    assert.ok(
      verifyMerkleProof(proof.data.blockHash, proof.data.path, proof.data.anchor.merkleRoot),
      "receipt hash verifies up to the published anchor root"
    );
    // response is hashes only — no transaction contents
    const raw = JSON.stringify(proof.data);
    assert.ok(!raw.includes("usr_") && !raw.includes("merchant") && !raw.includes("amount"), "no PII in proof");

    // unknown block → 404
    const missing = await call("/api/ledger/proof/99999");
    assert.equal(missing.status, 404);
  });
});
