// Tamper-evident, hash-chained audit log of security & financial events.
// Same design as the settlement ledger: every entry links to the previous
// entry's hash, so any retroactive edit is detectable via verify().
// Only non-sensitive metadata is stored (never PINs, tokens, or secrets).
import { sha256 } from "./ledger.js";

export class AuditLog {
  constructor(state) {
    if (state && Array.isArray(state.entries) && state.entries.length) {
      this.entries = state.entries;
    } else {
      this.entries = [];
      this._genesis();
    }
  }

  _genesis() {
    const e = { index: 0, ts: 0, event: "genesis", data: {}, prevHash: "0".repeat(64) };
    e.hash = this._hash(e);
    this.entries.push(e);
  }

  _hash(e) {
    return sha256(e.index + "|" + e.ts + "|" + e.event + "|" + JSON.stringify(e.data) + "|" + e.prevHash);
  }

  get head() { return this.entries[this.entries.length - 1]; }

  append(event, data) {
    const prev = this.head;
    const e = {
      index: prev.index + 1,
      ts: Date.now(),
      event: String(event),
      data: data || {},
      prevHash: prev.hash,
    };
    e.hash = this._hash(e);
    this.entries.push(e);
    return e;
  }

  verify() {
    for (let i = 1; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.prevHash !== this.entries[i - 1].hash) return { ok: false, reason: "broken link at " + i };
      if (e.hash !== this._hash(e)) return { ok: false, reason: "tampered entry " + i };
    }
    return { ok: true, entries: this.entries.length };
  }

  recent(n = 50) { return this.entries.slice(-n); }

  toJSON() { return { entries: this.entries }; }
}
