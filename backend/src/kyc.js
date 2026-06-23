// Mock KYC / AML screening. The interface mirrors what a real provider
// (Onfido, Sumsub, etc.) would expose; the decision logic is simulated.
import { ApiError } from "./fx.js";

const SANCTIONS_DENYLIST = ["john doe sanctioned", "blocked person"];

export function runKyc({ fullName, documentId, country, dateOfBirth }) {
  if (!fullName || !documentId || !country)
    throw new ApiError(400, "kyc_incomplete", "fullName, documentId and country are required");

  const sanctionsHit = SANCTIONS_DENYLIST.includes(String(fullName).trim().toLowerCase());
  if (sanctionsHit)
    return { status: "rejected", reason: "sanctions_match", checkedAt: Date.now() };

  // simulate document + liveness pass
  return {
    status: "verified",
    level: "tier-1",
    checks: { document: "pass", liveness: "pass", sanctions: "clear", pep: "clear" },
    country,
    checkedAt: Date.now(),
  };
}
