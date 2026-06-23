// File-backed JSON store with ATOMIC writes and corrupt-file quarantine.
// Not a production database, but crash-resistant, inspectable, and safe for the
// reference implementation. The same interface can be backed by Postgres.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_VERSION = 2;

const DEFAULT = () => ({
  schemaVersion: SCHEMA_VERSION,
  users: {},        // userId -> { id, name, country, kyc }
  accounts: {},     // userId -> { bank, maskedNumber, currency, balanceMinor, accountRefEnc }
  pins: {},         // userId -> versioned scrypt hash
  sessions: {},     // token -> { userId, exp, createdAt }
  payments: {},     // paymentId -> receipt
  idempotency: {},  // key -> paymentId
  requests: {},     // requestId -> collect request
  security: { fails: {}, locks: {} }, // failed-PIN counters + lockouts
  ledger: null,     // serialized dual ledger
  audit: null,      // serialized audit log
});

export class Store {
  constructor(path) {
    this.path = path;
    this.data = DEFAULT();
    if (path && existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        this.data = { ...DEFAULT(), ...parsed };
        if (!this.data.security) this.data.security = { fails: {}, locks: {} };
      } catch {
        // never start on corrupt data silently: quarantine, then reset
        try { copyFileSync(path, path + ".corrupt." + Date.now()); } catch {}
        this.data = DEFAULT();
      }
    }
  }
  persist() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path); // atomic rename on the same filesystem
  }
  reset() { this.data = DEFAULT(); this.persist(); }
}
