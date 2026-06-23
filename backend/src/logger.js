// Structured JSON logging with automatic redaction of sensitive fields.
import { randomUUID } from "node:crypto";

const SENSITIVE = new Set([
  "pin", "token", "authorization", "signature", "secret",
  "password", "key", "enckey", "signingsecret", "pinhash",
  "documentid", "accountref", "accountrefenc",
]);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (SENSITIVE.has(k.toLowerCase())) out[k] = "[redacted]";
      else out[k] = redact(value[k]);
    }
    return out;
  }
  return value;
}

function emit(level, msg, meta) {
  const rec = { ts: new Date().toISOString(), level, msg };
  if (meta && typeof meta === "object") Object.assign(rec, redact(meta));
  const line = JSON.stringify(rec);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  info: (msg, meta) => emit("info", msg, meta),
  warn: (msg, meta) => emit("warn", msg, meta),
  error: (msg, meta) => emit("error", msg, meta),
  debug: (msg, meta) => { if (process.env.BP_DEBUG === "true") emit("debug", msg, meta); },
  requestId: () => "req_" + randomUUID(),
};
