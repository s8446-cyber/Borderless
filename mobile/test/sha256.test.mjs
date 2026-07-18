// The mobile app carries its own SHA-256 (Hermes has no Web Crypto) and uses
// it to verify Merkle inclusion proofs on-device. If this hash is wrong, the
// app's "Verify this receipt independently" feature silently lies — so it is
// pinned here against node:crypto and FIPS 180-4 vectors, and the Merkle fold
// is cross-checked against the backend's implementation.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256, foldMerkleProof } from "../src/sha256.js";

const ref = (s) => createHash("sha256").update(s).digest("hex");

test("FIPS 180-4 vectors", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
});

test("matches node:crypto across sizes, block boundaries, and unicode", () => {
  const cases = [
    "a", "hello world", "x".repeat(55), "x".repeat(56), "x".repeat(63),
    "x".repeat(64), "x".repeat(65), "x".repeat(1000), "₹2,50,000 → café ☕", "🚀🔐",
  ];
  for (const c of cases) assert.equal(sha256(c), ref(c), JSON.stringify(c.slice(0, 20)));
});

test("foldMerkleProof reproduces the backend's Merkle math (odd level duplicates last)", () => {
  // Build the tree exactly the way backend/src/ledger.js does, then prove
  // inclusion of every leaf via the same {hash, right} path shape the API serves.
  const leaves = ["l0", "l1", "l2", "l3", "l4"].map(ref);
  const rootOf = (ls) => {
    let level = ls.slice();
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) next.push(ref(level[i] + (level[i + 1] ?? level[i])));
      level = next;
    }
    return level[0];
  };
  const proofOf = (ls, index) => {
    let level = ls.slice(); let i = index; const path = [];
    while (level.length > 1) {
      const next = [];
      for (let j = 0; j < level.length; j += 2) {
        const left = level[j]; const right = level[j + 1] ?? left;
        next.push(ref(left + right));
        if (j === i || j + 1 === i) path.push(i === j ? { hash: right, right: true } : { hash: left, right: false });
      }
      i = Math.floor(i / 2); level = next;
    }
    return path;
  };
  const root = rootOf(leaves);
  leaves.forEach((leaf, i) => {
    assert.equal(foldMerkleProof(leaf, proofOf(leaves, i)), root, `leaf ${i} folds to the root`);
  });
  // a tampered sibling must NOT fold to the root
  const bad = proofOf(leaves, 2).map((s, i) => (i === 0 ? { ...s, hash: ref("evil") } : s));
  assert.notEqual(foldMerkleProof(leaves[2], bad), root);
  // empty/absent path returns the leaf itself (single-block chains)
  assert.equal(foldMerkleProof(leaves[0], []), leaves[0]);
  assert.equal(foldMerkleProof(leaves[0], null), leaves[0]);
});
