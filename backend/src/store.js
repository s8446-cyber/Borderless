// File-backed JSON store with ATOMIC writes and corrupt-file quarantine.
// Not a production database, but crash-resistant, inspectable, and safe for the
// reference implementation. The same interface can be backed by Postgres.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_VERSION = 3;

export const DEFAULT = () => ({
  schemaVersion: SCHEMA_VERSION,
  users: {}, // userId -> { id, name, country, kyc }
  accounts: {}, // userId -> { bank, maskedNumber, currency, balanceMinor, accountRefEnc }
  pins: {}, // userId -> versioned scrypt hash
  sessions: {}, // token -> { userId, exp, createdAt, deviceHash? }
  refresh: {}, // refreshToken -> { userId, deviceHash?, exp, createdAt, rotatedTo? }
  credentials: {}, // email -> { userId, passHash, totpSecretEnc, totpEnabled, createdAt }
  resets: {}, // resetToken -> { email, exp }
  payments: {}, // paymentId -> receipt
  quotes: {}, // quoteId -> quote (TTL-bound; survives restart, multi-instance safe via shared store)
  idempotency: {}, // key -> paymentId
  requests: {}, // requestId -> collect request
  waitlist: [], // marketing-site early-access signups: { email, ts }
  security: { fails: {}, locks: {} }, // failed-PIN counters + lockouts
  beneficiaries: {}, // userId -> { beneficiaryKey -> { name, addedAt, sentDuringCoolingMinor } }
  devices: {}, // userId -> { deviceHash -> { firstSeen } } (device risk limits)
  payeeDirectory: {}, // beneficiaryKey -> registered account name (payee-name verification)
  riskHolds: {}, // paymentId -> escrow meta for payments pending fraud review
  pspPending: {}, // paymentId -> in-doubt settlement recovery state (attempts, nextRetryAt)
  webhookSeen: {}, // webhook eventId -> ts (replay rejection)
  aml: { alerts: [], reports: [] }, // transaction-monitoring alerts + STR/CTR reports
  disputes: {}, // disputeId -> customer dispute case
  ops: { actions: {} }, // maker-checker action queue for the ops back office
  recon: { breaks: [] }, // reconciliation settlement-break records
  ledger: null, // serialized dual ledger
  audit: null, // serialized audit log
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
