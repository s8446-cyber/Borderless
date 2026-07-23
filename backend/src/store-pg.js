// PostgreSQL-backed store (production persistence). Same interface as the
// file-backed Store — the app keeps its single-writer in-memory data model
// with synchronous access, and durability moves to Postgres:
//
//   bp_state        — the latest full state snapshot (json, single row)
//   ledger_blocks   — APPEND-ONLY mirror of settlement blocks
//   audit_entries   — APPEND-ONLY mirror of audit entries
//
// The mirrors are insert-only (ON CONFLICT DO NOTHING) and, in production,
// the app's database role gets INSERT+SELECT only on them (see db/schema.sql)
// so history cannot be rewritten even with the app's credentials — the hash
// chain + published anchors expose anything a DBA-level actor tries.
//
// SINGLE-WRITER SAFETY (fixes the concurrent-instance clobber hazard):
// the in-memory single-writer model is only correct with ONE writer process.
// On startup we take a Postgres SESSION-LEVEL ADVISORY LOCK on a dedicated
// connection. If another instance already holds it, create() FAILS CLOSED
// (throws) instead of silently overwriting the shared snapshot. This makes
// "multiple instances overwrite each other" impossible: a second instance
// cannot become the writer. (Horizontal scale-out needs the normalized,
// per-row transactional schema tracked in docs/PRODUCTION_READINESS.md; until
// then the lock guarantees correctness by admitting exactly one writer.)
//
// DURABILITY-BEFORE-ACK: persist() keeps the synchronous call signature used
// across the codebase, but every write is enqueued on a strictly ordered
// chain and the HTTP layer awaits flush() before returning success on any
// money-moving request (server.js) — so a crash can never lose a payment the
// client was told succeeded. flush() awaits the queue; close() ends cleanly.
//
// The `pg` driver is an OPTIONAL dependency — the zero-dependency core still
// runs without it; Postgres persistence activates only when BP_PG_URL is set.
import { DEFAULT } from "./store.js";
import { logger } from "./logger.js";

// A fixed 64-bit key for the writer advisory lock (arbitrary but stable).
const WRITER_LOCK_KEY = 4266280110; // "bp" writer lock

const DDL = `
CREATE TABLE IF NOT EXISTS bp_state (
  id          int PRIMARY KEY CHECK (id = 1),
  doc         json NOT NULL,   -- json (NOT jsonb): exact text preserved — hash chains recompute byte-identical
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_blocks (
  "index"    bigint PRIMARY KEY,
  ts         bigint NOT NULL,
  txn        json NOT NULL,    -- json (NOT jsonb): block hashes cover JSON.stringify(txn) verbatim
  prev_hash  text NOT NULL,
  hash       text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS audit_entries (
  "index"    bigint PRIMARY KEY,
  ts         bigint NOT NULL,
  event      text NOT NULL,
  data       json NOT NULL,    -- json (NOT jsonb): entry hashes cover the exact serialization
  prev_hash  text NOT NULL,
  hash       text NOT NULL UNIQUE
);
`;

export class PgStore {
  constructor(pool, lockClient) {
    this.pool = pool;
    this._lockClient = lockClient || null; // dedicated connection holding the writer lock
    this.data = DEFAULT();
    this._chain = Promise.resolve(); // strictly ordered write queue
    this._blocksMirrored = 0;        // next ledger block index to mirror
    this._auditMirrored = 0;         // next audit entry index to mirror
  }

  static async create(url) {
    let pg;
    try {
      pg = (await import("pg")).default;
    } catch {
      throw new Error("Postgres persistence requires the optional 'pg' driver — run: npm install pg");
    }
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    await pool.query(DDL);

    // Fail-closed single-writer guard: hold a session-level advisory lock on a
    // dedicated connection for the life of the process. If another instance is
    // already the writer, refuse to boot rather than clobber shared state.
    const lockClient = await pool.connect();
    const locked = await lockClient.query("SELECT pg_try_advisory_lock($1) AS ok", [WRITER_LOCK_KEY]);
    if (!locked.rows[0].ok) {
      lockClient.release();
      await pool.end();
      throw new Error(
        "FATAL: another Borderless writer already holds the Postgres advisory lock. " +
          "This deployment model admits exactly ONE writer instance (see store-pg.js / " +
          "docs/PRODUCTION_READINESS.md). Refusing to boot a second writer that would " +
          "overwrite shared state."
      );
    }

    const store = new PgStore(pool, lockClient);

    const r = await pool.query("SELECT doc FROM bp_state WHERE id = 1");
    if (r.rows.length) {
      store.data = { ...DEFAULT(), ...r.rows[0].doc };
      if (!store.data.security) store.data.security = { fails: {}, locks: {} };
    } else {
      await pool.query("INSERT INTO bp_state (id, doc) VALUES (1, $1::json)", [JSON.stringify(store.data)]);
    }

    // Mirror watermarks: resume after the highest already-mirrored index. If
    // the snapshot is ahead of the mirrors (crash between writes), the gap is
    // backfilled on the next persist().
    const lb = await pool.query('SELECT COALESCE(MAX("index"), -1) AS m FROM ledger_blocks');
    const ae = await pool.query('SELECT COALESCE(MAX("index"), -1) AS m FROM audit_entries');
    store._blocksMirrored = Number(lb.rows[0].m) + 1;
    store._auditMirrored = Number(ae.rows[0].m) + 1;
    return store;
  }

  // Synchronous signature (matches Store). Captures a point-in-time snapshot
  // and the not-yet-mirrored ledger/audit rows NOW; the actual write happens
  // on the ordered async chain. Blocks/entries are immutable after append, so
  // holding references is safe. The HTTP layer awaits flush() before ACKing a
  // money-moving response, so the durable write always precedes success.
  persist() {
    const json = JSON.stringify(this.data);
    const blocks = this.data.ledger?.blocks || [];
    const entries = this.data.audit?.entries || [];
    const newBlocks = blocks.slice(this._blocksMirrored);
    const newEntries = entries.slice(this._auditMirrored);
    this._blocksMirrored = blocks.length;
    this._auditMirrored = entries.length;

    this._chain = this._chain
      .then(() => this._write(json, newBlocks, newEntries))
      .catch((e) => {
        logger.error("pg_persist_failed", { message: String(e && e.message) });
        // Re-throw so flush() rejects and the HTTP layer can refuse to ACK a
        // write that did not become durable (no false "success").
        throw e;
      });
    // Swallow at the tail so an unawaited persist() never becomes an
    // unhandledRejection; awaited callers (flush) still see the failure.
    this._chain.catch(() => {});
    return this._chain;
  }

  async _write(json, newBlocks, newEntries) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE bp_state SET doc = $1::json, updated_at = now() WHERE id = 1", [json]);
      for (const b of newBlocks) {
        await client.query(
          'INSERT INTO ledger_blocks ("index", ts, txn, prev_hash, hash) VALUES ($1,$2,$3::json,$4,$5) ON CONFLICT ("index") DO NOTHING',
          [b.index, b.timestamp, JSON.stringify(b.txn), b.prevHash, b.hash]
        );
      }
      for (const e of newEntries) {
        await client.query(
          'INSERT INTO audit_entries ("index", ts, event, data, prev_hash, hash) VALUES ($1,$2,$3,$4::json,$5,$6) ON CONFLICT ("index") DO NOTHING',
          [e.index, e.ts, e.event, JSON.stringify(e.data || {}), e.prevHash, e.hash]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Await everything queued so far (durable). Used by the HTTP layer before
  // ACKing money-moving requests, and by shutdown/tests. Rejects if the most
  // recent write failed, so callers never report a non-durable success.
  async flush() {
    await this._chain;
  }

  async close() {
    try { await this.flush(); } catch { /* surface nothing on shutdown */ }
    try {
      if (this._lockClient) {
        await this._lockClient.query("SELECT pg_advisory_unlock($1)", [WRITER_LOCK_KEY]).catch(() => {});
        this._lockClient.release();
        this._lockClient = null;
      }
    } finally {
      await this.pool.end();
    }
  }

  reset() {
    this.data = DEFAULT();
    this._blocksMirrored = 0;
    this._auditMirrored = 0;
    this.persist();
  }
}
