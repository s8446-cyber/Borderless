# Sanctions Watchlist Screening — Real Data, Operated Honestly

How Borderless Pay screens payment counterparties against **real, authoritative
sanctions lists** — what is covered, what is deliberately NOT covered, and how
to operate the data pipeline.

## What it is

With `BP_SCREENING_PROVIDER=watchlist`, every outbound payment's payee name is
screened (in `src/screening.js`, called from the payment service on EVERY
payment) against a normalized dataset built from two public, authoritative,
no-registration sources:

| Source | Format | Publisher |
|---|---|---|
| UN Security Council Consolidated List | XML | scsanctions.un.org |
| US OFAC SDN list + alternate names (ALT) | CSV | sanctionslist.ofac.treas.gov (fallback: treasury.gov) |

A sanctions hit **blocks the payment, auto-files an STR, and raises an alert**
(same fail-closed policy the sandbox provider exercised; see
`src/payments.js`).

## What it is NOT (honest limitations)

- **No PEP data.** UN and OFAC publish sanctions designations only. There is
  no authoritative public PEP registry — PEP data is a commercial product
  (World-Check, Dow Jones, ComplyAdvantage). This provider returns real
  sanctions hits and **no** PEP hits. PEP screening arrives with a licensed
  vendor adapter (a one-entry addition to the provider registry).
- **Deterministic matching only.** Matching is exact on normalized names and
  aliases (diacritics folded, punctuation collapsed, token-order-insensitive).
  Tuned fuzzy/phonetic scoring is a vendor capability; faking one would create
  false confidence.
- **Not the whole compliance program.** These two lists are the global
  baseline; a licensed vendor also covers EU/UK/local lists and adverse media.

## Operating the pipeline

### 1. Build the dataset (ops-time; the server never downloads at boot)

```bash
cd backend
node scripts/update-watchlists.mjs --out /path/to/watchlists.json
```

Downloads both sources (with fallback URLs, 3-minute timeout each), parses
them, and **fail-closed validates**: minimum entry counts (UN >= 500,
OFAC >= 5000), individuals+entities present, alias linkage (>= 1000 ALT
names), >= 98% of OFAC rows fitting the expected shape, no empty names. Any
failure ⇒ non-zero exit and **nothing is written**. Output metadata records
source URLs, byte sizes, SHA-256 of each raw download, and `fetchedAt`.

Source URLs can be overridden via `BP_WATCHLIST_UN_URL`,
`BP_WATCHLIST_OFAC_SDN_URL`, `BP_WATCHLIST_OFAC_ALT_URL` (mirrors/proxies).

### 2. Verify it

```bash
node scripts/check-watchlists.mjs /path/to/watchlists.json
```

Loads the dataset through the **same loader + matcher the server uses** and
self-checks: a UN individual's primary name, one of its aliases, a
token-shuffled uppercase variant, and an OFAC name must all hit; an unrelated
name must stay clear.

### 3. Enable it

```bash
BP_SCREENING_PROVIDER=watchlist
BP_SCREENING_DATA=/app/data/watchlists.json   # on the persistent disk
# optional: BP_SCREENING_MAX_AGE_DAYS=45
```

On Render (render.yaml), place the file on the `bp-data` disk mounted at
`/app/data` before enabling — the server **refuses to boot** (fail-closed) if
the dataset is missing, malformed, truncated (< 1000 entries), or older than
`BP_SCREENING_MAX_AGE_DAYS` (default 45).

### 4. Keep it fresh

Sanctions lists change frequently. Refresh **at least weekly** (see
[`RUNBOOK.md`](./RUNBOOK.md) §7). CI re-runs the full pipeline against the
live downloads weekly and on every PR touching it
(`.github/workflows/watchlists.yml`) — a red run means a source format
changed and the parser needs updating before the next refresh.

## Design decisions (for auditors)

- **File-based dataset, not boot-time download**: deploys must not depend on
  third-party uptime; the dataset is versionable, reviewable, and its SHA-256
  provenance is recorded.
- **Fail-closed everywhere**: unknown provider name, missing/invalid/stale
  dataset, or a source format change all stop the process (or the refresh)
  loudly instead of silently screening against nothing.
- **Sandbox provider retained** for tests/dev/staging — clearly fake fixtures
  ("blocked person") and a loud boot warning if production ever runs it.
- **Zero runtime dependencies** — parsers are small, tested (see
  `test/screening-watchlist.test.js`), and gate on structure so they cannot
  silently mis-parse.
