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

export class DualLedger {
  constructor(state) {
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
  append(txn) {
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
    const anchor = {
      anchorId: "anc_" + this.anchors.length,
      fromIndex: from,
      toIndex: to,
      merkleRoot: merkleRoot(leaves),
      publishedAt: Date.now(),
      // simulated public-chain tx hash
      publicTxHash: "0x" + sha256("anchor" + from + to + Date.now()).slice(0, 40),
    };
    this.anchors.push(anchor);
    return anchor;
  }

  // Recompute the entire chain to detect tampering.
  verify() {
    for (let i = 1; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (b.prevHash !== this.blocks[i - 1].hash)
        return { ok: false, reason: `broken link at block ${i}` };
      if (b.hash !== hashBlock(b))
        return { ok: false, reason: `tampered block ${i}` };
    }
    // verify each anchor's merkle root still matches its range
    for (const a of this.anchors) {
      const leaves = this.blocks.slice(a.fromIndex, a.toIndex + 1).map((b) => b.hash);
      if (merkleRoot(leaves) !== a.merkleRoot)
        return { ok: false, reason: `anchor ${a.anchorId} mismatch` };
    }
    return { ok: true, blocks: this.blocks.length, anchors: this.anchors.length };
  }

  toJSON() {
    return { blocks: this.blocks, anchors: this.anchors, anchorEvery: this.anchorEvery };
  }
}
