// Dual-ledger implementation (the design from the plan, §7).
//
//  Ledger A — Settlement ledger: an append-only, hash-chained log. Each block
//             commits a transaction and links to the previous block's hash, so
//             any retroactive edit breaks the chain (tamper-evident).
//
//  Ledger B — Public anchor: periodically we compute a Merkle root over a batch
//             of settlement-block hashes and "publish" it as an anchor. In
//             production this hash is written to a public chain; here we keep the
//             anchor records and expose verification so integrity is provable
//             without exposing the private transaction data.
import { createHash } from "node:crypto";

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function hashBlock(b) {
  return sha256(
    `${b.index}|${b.timestamp}|${JSON.stringify(b.txn)}|${b.prevHash}`
  );
}

// Merkle root over an array of hex-leaf hashes.
export function merkleRoot(leaves) {
  if (leaves.length === 0) return sha256("");
  let level = leaves.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left; // duplicate last if odd
      next.push(sha256(left + right));
    }
    level = next;
  }
  return level[0];
}

// Merkle INCLUSION proof (G-4): the sibling path from leaf `index` up to the
// root. Mirrors merkleRoot exactly (odd levels duplicate the last node).
// Each step is { hash, right } — `right: true` means the sibling is on the
// right, i.e. hash(current + sibling); otherwise hash(sibling + current).
export function merkleProof(leaves, index) {
  if (index < 0 || index >= leaves.length) return null;
  let level = leaves.slice();
  let i = index;
  const path = [];
  while (level.length > 1) {
    const next = [];
    for (let j = 0; j < level.length; j += 2) {
      const left = level[j];
      const right = level[j + 1] ?? left;
      next.push(sha256(left + right));
      if (j === i || j + 1 === i) {
        if (i === j) path.push({ hash: right, right: true });
        else path.push({ hash: left, right: false });
      }
    }
    i = Math.floor(i / 2);
    level = next;
  }
  return path;
}

// Anyone (no login, no transaction data) can recompute leaf → root with this.
export function verifyMerkleProof(leafHash, path, root) {
  let h = leafHash;
  for (const step of path || []) {
    h = step.right ? sha256(h + step.hash) : sha256(step.hash + h);
  }
  return h === root;
}

// Default anchor publisher: simulates a public-chain write. In production this
// is swapped (via DualLedger's `publisher` option) for a writer that commits
// the Merkle root to an actual public chain and returns the real tx hash.
export function simulatedPublisher({ fromIndex, toIndex }) {
  return "0x" + sha256("anchor" + fromIndex + toIndex + Date.now()).slice(0, 40);
}

export class DualLedger {
  constructor(state, opts = {}) {
    this.publisher = opts.publisher || simulatedPublisher;
    if (state && state.blocks?.length) {
      this.blocks = state.blocks;
      this.anchors = state.anchors ?? [];
      this.anchorEvery = state.anchorEvery ?? 1;
    } else {
      this.anchorEvery = state?.anchorEvery ?? 1;
      this.blocks = [];
      this.anchors = [];
      this._genesis();
    }
  }

  _genesis() {
    const block = {
      index: 0,
      timestamp: 0,
      txn: { type: "genesis" },
      prevHash: "0".repeat(64),
    };
    block.hash = hashBlock(block);
    this.blocks.push(block);
  }

  get head() { return this.blocks[this.blocks.length - 1]; }

  // Append a settlement record; returns the block and (if triggered) anchor.
  // If the txn carries double-entry legs, the zero-sum invariant is enforced
  // HERE, at write time — an unbalanced entry can never enter the chain.
  append(txn) {
    if (txn && txn.legs !== undefined) {
      const err = validateLegs(txn.legs);
      if (err) throw new Error("unbalanced ledger entry: " + err);
    }
    const prev = this.head;
    const block = {
      index: prev.index + 1,
      timestamp: Date.now(),
      txn,
      prevHash: prev.hash,
    };
    block.hash = hashBlock(block);
    this.blocks.push(block);

    let anchor = null;
    // Genesis (block 0) is never anchored; only settlement blocks are batched.
    const unanchored = (this.blocks.length - 1) - this._anchoredCount();
    if (unanchored >= this.anchorEvery) anchor = this._publishAnchor();
    return { block, anchor };
  }

  _anchoredCount() {
    return this.anchors.reduce((n, a) => n + (a.toIndex - a.fromIndex + 1), 0);
  }

  _publishAnchor() {
    const from = 1 + this._anchoredCount();
    const to = this.blocks.length - 1;
    const leaves = this.blocks.slice(from, to + 1).map((b) => b.hash);
    const root = merkleRoot(leaves);
    const anchor = {
      anchorId: "anc_" + this.anchors.length,
      fromIndex: from,
      toIndex: to,
      merkleRoot: root,
      publishedAt: Date.now(),
      // pluggable: simulated by default, real public-chain writer in production
      publicTxHash: this.publisher({ fromIndex: from, toIndex: to, merkleRoot: root }),
    };
    this.anchors.push(anchor);
    return anchor;
  }

  // Merkle inclusion proof for a settlement block (G-4). Returns everything a
  // third party needs to verify — WITHOUT any transaction contents: the block
  // hash, the sibling path, and the anchor it rolls up to. Null if the block
  // doesn't exist or isn't anchored yet.
  proof(blockIndex) {
    const block = this.blocks[blockIndex];
    if (!block || blockIndex === 0) return null;
    const anchor = this.anchors.find((a) => a.fromIndex <= blockIndex && blockIndex <= a.toIndex);
    if (!anchor) return null;
    const leaves = this.blocks.slice(anchor.fromIndex, anchor.toIndex + 1).map((b) => b.hash);
    const path = merkleProof(leaves, blockIndex - anchor.fromIndex);
    return {
      blockIndex,
      blockHash: block.hash,
      path,
      anchor: {
        anchorId: anchor.anchorId,
        merkleRoot: anchor.merkleRoot,
        publicTxHash: anchor.publicTxHash,
        publishedAt: anchor.publishedAt,
      },
    };
  }

  // Recompute the entire chain to detect tampering.
  verify() {
    for (let i = 1; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (b.prevHash !== this.blocks[i - 1].hash)
        return { ok: false, reason: `broken link at block ${i}` };
      if (b.hash !== hashBlock(b))
        return { ok: false, reason: `tampered block ${i}` };
      if (b.txn && b.txn.legs !== undefined) {
        const err = validateLegs(b.txn.legs);
        if (err) return { ok: false, reason: `block ${i}: ${err}` };
      }
    }
    // verify each anchor's merkle root still matches its range
    for (const a of this.anchors) {
      const leaves = this.blocks.slice(a.fromIndex, a.toIndex + 1).map((b) => b.hash);
      if (merkleRoot(leaves) !== a.merkleRoot)
        return { ok: false, reason: `anchor ${a.anchorId} mismatch` };
    }
    return { ok: true, blocks: this.blocks.length, anchors: this.anchors.length };
  }

  // Fold all double-entry legs into per-account balances. Because every entry
  // is zero-sum, the grand total across all accounts is always exactly 0 —
  // this is the reconciliation invariant a settlement-break monitor watches.
  balances() {
    const out = {};
    for (const b of this.blocks) {
      const legs = (b.txn && b.txn.legs) || [];
      for (const leg of legs) {
        out[leg.account] = (out[leg.account] || 0) + leg.deltaMinor;
      }
    }
    return out;
  }

  toJSON() {
    return { blocks: this.blocks, anchors: this.anchors, anchorEvery: this.anchorEvery };
  }
}

// Returns null if legs are well-formed and zero-sum, else a reason string.
function validateLegs(legs) {
  if (!Array.isArray(legs) || legs.length < 2) return "legs must be an array of at least 2 entries";
  let sum = 0;
  for (const leg of legs) {
    if (!leg || typeof leg.account !== "string" || !leg.account) return "leg missing account";
    if (!Number.isInteger(leg.deltaMinor)) return "leg deltaMinor must be an integer (minor units)";
    sum += leg.deltaMinor;
  }
  if (sum !== 0) return "legs do not sum to zero (sum=" + sum + ")";
  return null;
}
