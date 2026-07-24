// Transaction-time sanctions / PEP screening — pluggable provider registry,
// same pattern as kyc.js. KYC screens the ACCOUNT HOLDER once at onboarding;
// this screens the COUNTERPARTY (payee / recipient / merchant) on EVERY
// outbound payment, which onboarding can never cover.
//
// Contract (mirrors commercial screening vendors — Refinitiv World-Check,
// Dow Jones, ComplyAdvantage):
//   screenParty({ name }) →
//     { clear: true } | { clear: false, list: "sanctions" | "pep", matched }
//
// Policy applied by the payment service:
//   sanctions hit → payment BLOCKED + STR auto-filed + alert (fail-closed)
//   pep hit       → payment allowed + alert (enhanced-due-diligence flag)

// Sandbox watchlists: tiny, obviously-fake fixtures so the block/flag paths
// are exercisable end-to-end without a vendor account.
const SANDBOX_SANCTIONS = ["blocked person", "sanctioned entity", "embargoed trader"];
const SANDBOX_PEP = ["prominent politician", "exposed person"];

function norm(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sandboxScreen({ name }) {
  const n = norm(name);
  if (!n) return { clear: true };
  if (SANDBOX_SANCTIONS.includes(n)) return { clear: false, list: "sanctions", matched: n };
  if (SANDBOX_PEP.includes(n)) return { clear: false, list: "pep", matched: n };
  return { clear: true };
}

// Register providers here. A licensed adapter is a one-entry addition.
const PROVIDERS = { sandbox: sandboxScreen };

const providerName = (process.env.BP_SCREENING_PROVIDER || "sandbox").trim().toLowerCase();
const selected = PROVIDERS[providerName];
if (!selected) {
  throw new Error(
    `FATAL config: unknown BP_SCREENING_PROVIDER "${providerName}" (registered: ${Object.keys(PROVIDERS).join(", ")})`
  );
}

export const SCREENING_PROVIDER = providerName;

export function screenParty(input) {
  return selected(input);
}
