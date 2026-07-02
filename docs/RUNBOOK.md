# Borderless Pay — Operations & Incident Response Runbook

**Audience:** on-call engineer. **Goal:** detect fast, contain fast, never guess with money.

---

## 1. Observability surface

| Endpoint | What it tells you | Auth |
|---|---|---|
| `GET /api/health` | Liveness (process up) | none |
| `GET /api/ready` | Readiness **+ full ledger & audit integrity re-verification** | none |
| `GET /api/metrics` | Prometheus metrics (traffic, latency, payments, fees, rate limits, chain sizes, sessions, memory) | `BP_METRICS_TOKEN` bearer (required in prod; endpoint hidden if unset) |
| `GET /api/ledger/verify` | Settlement-chain integrity | none |
| `GET /api/audit/verify` | Audit-chain integrity | none |

Logs are structured JSON on stdout/stderr with automatic secret redaction. Every response carries `x-request-id` — grep logs by it.

### Key metrics to alert on
| Alert | Rule of thumb | Severity |
|---|---|---|
| Integrity failure | `/api/ready` returns 503 | **SEV-1** |
| Error rate | `bp_http_requests_total{status=~"5.."}` > 1% of traffic | SEV-2 |
| Latency | `bp_http_request_duration_ms` p99 > 1000ms sustained | SEV-3 |
| Rate-limit storm | `bp_rate_limited_total` spiking | SEV-2 (possible attack) |
| Session anomaly | `refresh_reuse_detected` events in audit log | SEV-2 (credential theft signal) |
| Memory | `bp_process_resident_memory_bytes` monotonic growth | SEV-3 |
| Business flatline | `bp_payments_settled_total` flat during peak hours | SEV-2 |

## 2. Severity levels

- **SEV-1** — money integrity at risk: ledger/audit verification failing, suspected tampering, secret leak. *Page immediately; consider full stop.*
- **SEV-2** — security or availability degraded: attack in progress, error-rate spike, credential-theft signals.
- **SEV-3** — degraded but safe: latency, memory growth, single-feature failure.

## 3. Scenario playbooks

### 3.1 `/api/ready` returns 503 (integrity check failed) — SEV-1
The ledger or audit hash chain no longer verifies. **This is the one alarm that can never be ignored.**
1. **Stop money movement:** take the instance out of the load balancer (health check on `/api/ready` does this automatically).
2. Snapshot the store file immediately: `cp $BP_DB /forensics/db-$(date +%s).json` — do not restart first; a restart persists state.
3. Compare against the last known-good backup. `GET /api/ledger/verify` reports the exact first broken block index.
4. If the last published anchor's Merkle root matches an external record, everything up to that anchor is provably intact — restore to it.
5. File a security incident; treat as potential insider/DBA tampering until proven otherwise.

### 3.2 `refresh_reuse_detected` in the audit log — SEV-2
A rotated refresh token was replayed → the server already revoked all of that user's sessions automatically.
1. Confirm auto-revocation: no live sessions for the user (`bp_sessions_active` drop / store inspection).
2. Look for correlated events from the same IP in logs (`x-request-id` chain).
3. If multiple users hit within a short window, assume token-store exposure: rotate `BP_SIGNING_SECRET`, force `revoke-all` platform-wide (delete `sessions` + `refresh` maps), notify users.

### 3.3 Rate-limit storm (`bp_rate_limited_total` spiking) — SEV-2
1. Identify source IPs from `rate_limited` audit entries.
2. Block upstream (WAF/proxy) — the app limiter is the last line, not the first.
3. If distributed, temporarily lower `BP_RL_MAX` / `BP_RL_AUTH_MAX` (env change + restart; graceful shutdown persists state).

### 3.4 Corrupt store on boot
The store quarantines unreadable files as `db.json.corrupt.<ts>` and starts fresh — **it never silently overwrites**.
1. The quarantined file is the evidence; keep it.
2. Restore the newest good backup to `$BP_DB`, restart, and check `/api/ready`.
3. Root-cause: disk full, partial write (should be impossible — writes are atomic rename), or manual edit.

### 3.5 Secret exposure (signing key / enc key / metrics token) — SEV-1
1. Rotate the leaked value in the secret manager; restart.
2. `BP_SIGNING_SECRET` rotated → old receipt signatures no longer verify with the new key: keep the old key available (offline) for historical verification; note rotation timestamp in the audit log.
3. `BP_ENC_KEY` rotated → re-encrypt stored `accountRefEnc` fields (decrypt with old, encrypt with new) before discarding the old key.
4. Revoke all sessions platform-wide.

### 3.6 Port already in use / instance won't start
`PORT=<other> npm start`, or find and stop the stale process. In prod the orchestrator (Fly/Render/compose `restart: always`) handles supervision.

## 4. Backup & restore
- The store file (`$BP_DB`) is the entire state: users, accounts, payments, ledger, audit.
- Writes are atomic (`tmp` + rename), mode `0600`.
- Back up on a schedule appropriate to volume; restore = replace file + restart + verify `/api/ready`.
- Post-Postgres migration (see `backend/db/schema.sql`): PITR + tested restores replace file copies; the append-only role policy on `ledger_blocks`/`audit_entries` is part of the control, not an optimization.

## 5. Graceful shutdown
`SIGTERM`/`SIGINT` → server stops accepting, performs a final durable persist of ledger + audit, exits (5s hard cap). Never `kill -9` a healthy instance if avoidable; if it happens anyway, state loss is bounded to since-last-persist (every payment persists synchronously).

## 6. Escalation
1. On-call engineer (this runbook).
2. Security lead — any SEV-1, any suspected tampering or leak.
3. Founders — SEV-1, or anything customer-visible for a sustained period.
4. Post-incident: blameless write-up; new regression test for every root cause (the suite is the institutional memory).
