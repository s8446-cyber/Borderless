// Zero-dependency observability (G-7): a Prometheus-text-format metrics
// registry. Tracks HTTP traffic (by normalized route, so IDs never explode
// label cardinality), request latency, settled payments and fee revenue,
// rate-limit rejections, and point-in-time gauges (ledger size, sessions,
// process memory). Scraped at GET /api/metrics.
export class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.http = new Map();      // "METHOD|route|status" -> count
    // Hard cap on distinct HTTP series. route() collapses known dynamic
    // segments, but an unmatched path label is only trustworthy if the caller
    // passes one it controls; this cap is a defense-in-depth backstop so a
    // flood of never-before-seen labels can never grow the map without bound
    // (metric-cardinality memory exhaustion). Overflow folds into "other".
    this.maxHttpSeries = 500;
    this.latency = {
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
      counts: new Array(10).fill(0), // one per bucket + +Inf
      sum: 0,
      count: 0,
    };
    this.payments = new Map();  // kind -> { count, totalMinor, feeMinor }
    this.rateLimited = 0;
  }

  // Collapse dynamic path segments so every request maps to a stable route
  // label: numeric segments and prefixed IDs (usr_/pay_/req_/q_) become tokens.
  route(path) {
    return String(path)
      .replace(/\/(usr|pay|req|q|tok|rtk|anc)_[A-Za-z0-9-]+/g, "/:id")
      .replace(/\/\d+(?=\/|$)/g, "/:n");
  }

  recordHttp(method, path, status, ms) {
    let key = method + "|" + this.route(path) + "|" + status;
    // Cardinality backstop: if this is a brand-new series and we're already at
    // the cap, bucket it under a single "other" route rather than allocating
    // an unbounded number of Map entries from crafted/unknown paths.
    if (!this.http.has(key) && this.http.size >= this.maxHttpSeries) {
      key = method + "|/other|" + status;
    }
    this.http.set(key, (this.http.get(key) || 0) + 1);
    const L = this.latency;
    L.sum += ms;
    L.count++;
    let placed = false;
    for (let i = 0; i < L.buckets.length; i++) {
      if (ms <= L.buckets[i]) { L.counts[i]++; placed = true; break; }
    }
    if (!placed) L.counts[L.counts.length - 1]++; // +Inf
  }

  recordPayment(receipt) {
    const kind = receipt.kind || "payment";
    const p = this.payments.get(kind) || { count: 0, totalMinor: 0, feeMinor: 0 };
    p.count++;
    p.totalMinor += receipt.totalMinor || 0;
    p.feeMinor += receipt.feeMinor || 0;
    this.payments.set(kind, p);
  }

  recordRateLimited() { this.rateLimited++; }

  // Render Prometheus exposition format. Gauges are computed at scrape time
  // from the live app objects passed in.
  render({ ledger, audit, store } = {}) {
    const lines = [];
    const add = (name, help, type, series) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const [labels, value] of series) {
        lines.push(name + (labels ? `{${labels}}` : "") + " " + value);
      }
    };

    add("bp_http_requests_total", "HTTP API requests by method, route and status", "counter",
      [...this.http.entries()].map(([k, v]) => {
        const [method, route, status] = k.split("|");
        return [`method="${method}",route="${route}",status="${status}"`, v];
      }));

    const L = this.latency;
    const hist = [];
    let cumulative = 0;
    for (let i = 0; i < L.buckets.length; i++) {
      cumulative += L.counts[i];
      hist.push([`le="${L.buckets[i]}"`, cumulative]);
    }
    hist.push([`le="+Inf"`, L.count]);
    add("bp_http_request_duration_ms_bucket", "API request latency histogram (ms)", "histogram", hist);
    lines.push("bp_http_request_duration_ms_sum " + L.sum);
    lines.push("bp_http_request_duration_ms_count " + L.count);

    add("bp_payments_settled_total", "Settled payments by kind (replays excluded)", "counter",
      [...this.payments.entries()].map(([kind, p]) => [`kind="${kind}"`, p.count]));
    add("bp_payments_volume_minor_total", "Settled payment volume in minor units by kind", "counter",
      [...this.payments.entries()].map(([kind, p]) => [`kind="${kind}"`, p.totalMinor]));
    add("bp_fee_revenue_minor_total", "Fee revenue in minor units by kind", "counter",
      [...this.payments.entries()].map(([kind, p]) => [`kind="${kind}"`, p.feeMinor]));

    add("bp_rate_limited_total", "Requests rejected by the rate limiter", "counter",
      [["", this.rateLimited]]);

    if (ledger) {
      add("bp_ledger_blocks", "Settlement ledger chain length", "gauge", [["", ledger.blocks.length]]);
      add("bp_ledger_anchors", "Published Merkle anchors", "gauge", [["", ledger.anchors.length]]);
    }
    if (audit) add("bp_audit_entries", "Audit log chain length", "gauge", [["", audit.entries.length]]);
    if (store) {
      add("bp_sessions_active", "Live session tokens", "gauge", [["", Object.keys(store.data.sessions || {}).length]]);
      add("bp_quotes_pending", "Unconsumed quotes", "gauge", [["", Object.keys(store.data.quotes || {}).length]]);
      add("bp_waitlist_size", "Waitlist signups", "gauge", [["", (store.data.waitlist || []).length]]);
    }
    add("bp_process_resident_memory_bytes", "Process RSS", "gauge", [["", process.memoryUsage().rss]]);
    add("bp_uptime_seconds", "Seconds since process start", "gauge",
      [["", Math.floor((Date.now() - this.startedAt) / 1000)]]);

    return lines.join("\n") + "\n";
  }
}
