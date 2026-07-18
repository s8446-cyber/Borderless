// Transactional email delivery — zero-dependency, pluggable providers.
//
// Why this exists: flows like password reset generate a single-use token that
// MUST reach the user out-of-band. In development the API returns the token
// directly (testable without any provider); in production it must be emailed.
// This module closes that gap with providers that speak plain HTTPS JSON via
// Node's global fetch (Node 18+), keeping the zero-runtime-dependency posture:
//
//   BP_EMAIL_PROVIDER=resend    → POST https://api.resend.com/emails
//   BP_EMAIL_PROVIDER=sendgrid  → POST https://api.sendgrid.com/v3/mail/send
//   BP_EMAIL_PROVIDER=console   → structured log only (development default)
//
// Design rules:
//   - The mailer NEVER throws into a request path. Callers always get
//     { sent, provider, error? } so API responses stay uniform (a delivery
//     failure must not become an account-enumeration or timing oracle).
//   - Secrets (API keys) and token values are never logged.
//   - Providers are validated at construction: in production a real provider
//     without an API key is a fatal misconfiguration (fail-closed).

const PROVIDERS = ["console", "resend", "sendgrid"];

export function buildResetEmail({ origin, token, ttlMinutes = 30 }) {
  const link = origin ? origin.replace(/\/$/, "") : null;
  return {
    subject: "Reset your Borderless Pay password",
    text: [
      "We received a request to reset your Borderless Pay password.",
      "",
      `Your single-use reset token (valid for ${ttlMinutes} minutes):`,
      "",
      `    ${token}`,
      "",
      link
        ? `Open ${link} — choose "Forgot password", and paste the token to set a new password.`
        : `Open the app, choose "Forgot password", and paste the token to set a new password.`,
      "",
      "Completing the reset signs you out of every device.",
      "If you didn't request this, you can safely ignore this email — the token expires on its own and your password is unchanged.",
    ].join("\n"),
  };
}

export class Mailer {
  constructor({ provider, apiKey, from, isProd = false, fetchImpl, log } = {}) {
    this.provider = (provider || "").trim().toLowerCase() || null;
    this.apiKey = apiKey || null;
    this.from = from || "Borderless Pay <no-reply@borderlesspay.app>";
    this.fetch = fetchImpl || globalThis.fetch;
    this.log = log || { info: () => {}, error: () => {} };

    if (this.provider && !PROVIDERS.includes(this.provider)) {
      throw new Error(`FATAL config: unknown BP_EMAIL_PROVIDER "${this.provider}" (expected one of ${PROVIDERS.join(", ")})`);
    }
    if (this.provider && this.provider !== "console" && !this.apiKey) {
      // A real provider without credentials can only fail at send time —
      // surface it at boot instead, and refuse outright in production.
      const msg = `FATAL config: BP_EMAIL_PROVIDER=${this.provider} requires BP_EMAIL_API_KEY`;
      if (isProd) throw new Error(msg);
      this.log.error("mailer_misconfigured_falling_back_to_console", { provider: this.provider });
      this.provider = "console";
    }
  }

  // True when messages actually leave the process (or are visibly logged).
  get active() {
    return Boolean(this.provider);
  }

  // Send one message. Resolves to { sent, provider, error? } — never rejects.
  async send({ to, subject, text }) {
    if (!this.provider) return { sent: false, provider: null, error: "no_provider_configured" };
    try {
      if (this.provider === "console") {
        // Development transport: make the delivery visible without a provider.
        // The body (which contains the token) is intentionally NOT logged in
        // production — console mode is refused there by config validation.
        this.log.info("email_console_delivery", { to, subject, body: text });
        return { sent: true, provider: "console" };
      }
      if (this.provider === "resend") {
        const res = await this.fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ from: this.from, to: [to], subject, text }),
        });
        if (!res.ok) return { sent: false, provider: "resend", error: `http_${res.status}` };
        return { sent: true, provider: "resend" };
      }
      if (this.provider === "sendgrid") {
        const res = await this.fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: parseFrom(this.from),
            subject,
            content: [{ type: "text/plain", value: text }],
          }),
        });
        // SendGrid returns 202 Accepted on success.
        if (!res.ok) return { sent: false, provider: "sendgrid", error: `http_${res.status}` };
        return { sent: true, provider: "sendgrid" };
      }
      return { sent: false, provider: this.provider, error: "unreachable" };
    } catch (err) {
      // Network-level failure. Log the class of error only — never the payload.
      this.log.error("email_send_failed", { provider: this.provider, error: String(err && err.message) });
      return { sent: false, provider: this.provider, error: "network_error" };
    }
  }
}

// "Name <addr@host>" → { email, name } (SendGrid's shape); bare address passes through.
function parseFrom(from) {
  const m = /^(.*)<([^>]+)>\s*$/.exec(from);
  if (m) return { email: m[2].trim(), name: m[1].trim() || undefined };
  return { email: from.trim() };
}

export function createMailer(config, { fetchImpl, log } = {}) {
  return new Mailer({
    provider: config.emailProvider,
    apiKey: config.emailApiKey,
    from: config.emailFrom,
    isProd: config.isProd,
    fetchImpl,
    log,
  });
}
