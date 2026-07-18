// KYC / AML screening — pluggable provider registry.
//
// The provider is selected with BP_KYC_PROVIDER (default: "sandbox"). Every
// provider implements the same contract, which mirrors what a licensed vendor
// (Onfido, Sumsub, HyperVerge, IDfy, …) exposes:
//
//   run({ fullName, documentId, country, dateOfBirth }) →
//     { status: "verified" | "rejected" | "pending",
//       level?, checks?, reason?, country?, checkedAt }
//
// To integrate a real provider: add an async adapter that calls the vendor's
// API (credentials via env), register it below, and set BP_KYC_PROVIDER.
// Nothing else in the codebase changes — payments already gate on
// `user.kyc.status === "verified"`.
//
// The sandbox provider simulates document + liveness + sanctions screening and
// auto-approves (with a denylist to exercise the rejection path). It exists so
// the full product is testable with no vendor account; production deployments
// are loudly warned at boot while it is still selected (see server.js).
import { ApiError } from "./fx.js";
import { config } from "./config.js";

const SANCTIONS_DENYLIST = ["john doe sanctioned", "blocked person"];

function sandboxKyc({ fullName, documentId, country }) {
  if (!fullName || !documentId || !country)
    throw new ApiError(400, "kyc_incomplete", "fullName, documentId and country are required");

  const sanctionsHit = SANCTIONS_DENYLIST.includes(String(fullName).trim().toLowerCase());
  if (sanctionsHit)
    return { status: "rejected", reason: "sanctions_match", provider: "sandbox", checkedAt: Date.now() };

  // simulate document + liveness pass
  return {
    status: "verified",
    level: "tier-1",
    provider: "sandbox",
    checks: { document: "pass", liveness: "pass", sanctions: "clear", pep: "clear" },
    country,
    checkedAt: Date.now(),
  };
}

// Register providers here. A licensed adapter is a one-entry addition.
const PROVIDERS = {
  sandbox: sandboxKyc,
};

const selected = PROVIDERS[config.kycProvider];
if (!selected) {
  // Unknown provider names are a deployment mistake — refuse to run with a
  // silently wrong KYC path (fail-closed, same policy as missing secrets).
  throw new Error(
    `FATAL config: unknown BP_KYC_PROVIDER "${config.kycProvider}" (registered: ${Object.keys(PROVIDERS).join(", ")})`
  );
}

export const KYC_PROVIDER = config.kycProvider;

export function runKyc(input) {
  return selected(input);
}
