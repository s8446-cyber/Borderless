// DSR — data-principal rights under the DPDP Act 2023 (mirrors GDPR arts.
// 15/16): self-serve data-ACCESS export and profile CORRECTION. Completes the
// rights triad next to consent withdrawal + erasure (POST /api/account/close
// in server.js).
//
// Both endpoints require recent password reauthentication (same discipline as
// account closure — a stolen bearer token alone can never exfiltrate the
// full data file or rewrite identity attributes) and sit on the stricter
// auth rate-limit tier.
//
// What the export deliberately EXCLUDES — and why it is lawful to do so:
//   - AML monitoring working data (alerts, CTR/STR reports): disclosing
//     these to the subject is the PMLA "tipping-off" offence; DPDP §17
//     exempts processing for prevention/investigation of offences.
//   - The tamper-evident audit/ledger chains: security infrastructure, not
//     self-serve personal data; pseudonymous records are retained under
//     PMLA/RBI rules even after erasure. Both facts are stated in the export.
import { verifyPinAsync } from "./auth.js";
import { asString } from "./security.js";
import { decryptField } from "./crypto.js";
import { runKyc } from "./kyc.js";
import { ApiError } from "./fx.js";
import { fromMinor } from "./money.js";

export function registerDsrRoutes({ add, store, guard, audit, persist, payments, ops, requireAuth, credentialsByUser }) {
  // Recent-reauthentication gate, identical to the account-closure flow:
  // failures count toward the login lockout scope and are audited.
  async function reauth(req, body, userId, action) {
    const found = credentialsByUser(userId);
    if (!found) return null;
    guard.assertNotLocked(userId, "login");
    const password = asString(body.password, "password", { max: 200 });
    if (!(await verifyPinAsync(password, found.cred.passHash))) {
      const r = guard.recordFail(userId, "login");
      audit.append(action + "_reauth_failed", { userId, locked: r.locked });
      persist();
      throw new ApiError(401, "reauth_required", "Enter your current password to continue");
    }
    guard.recordSuccess(userId, "login");
    return found;
  }

  // ---- Data-access export (DPDP right to access) -------------------------
  // Returns EVERYTHING the platform holds about the caller, machine-readable.
  add("POST", /^\/api\/account\/export$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const u = store.data.users[userId] || {};
    if (u.closed) throw new ApiError(409, "account_closed", "This account is closed");
    const found = await reauth(req, body, userId, "dsr_export");

    const account = store.data.accounts[userId] || null;
    const sessions = [];
    for (const s of Object.values(store.data.sessions || {})) {
      const sid = typeof s === "string" ? s : s.userId;
      if (sid !== userId) continue;
      sessions.push(typeof s === "string"
        ? { createdAt: null, expiresAt: null, deviceBound: false }
        : { createdAt: s.createdAt || null, expiresAt: s.exp || null, deviceBound: Boolean(s.deviceHash) });
    }
    const devices = Object.entries((store.data.devices || {})[userId] || {})
      .map(([deviceHash, rec]) => ({ deviceHash, firstSeen: rec.firstSeen || null }));
    const email = (found && found.email) || u.email || null;
    const waitlist = (store.data.waitlist || []).filter((w) => email && w.email === email);

    audit.append("dsr_export", { userId });
    persist();

    return {
      format: "borderless-pay/dsr-export/v1",
      exportedAt: new Date().toISOString(),
      profile: {
        userId,
        name: u.name || null,
        email,
        country: u.country || null,
        kyc: u.kyc || null,
        consent: u.consent || null,
      },
      credential: found
        ? { email: found.email, totpEnabled: Boolean(found.cred.totpEnabled), createdAt: found.cred.createdAt || null }
        : null,
      account: account
        ? {
            bank: account.bank,
            maskedNumber: account.maskedNumber,
            currency: account.currency,
            balanceMinor: account.balanceMinor,
            balance: fromMinor(account.balanceMinor),
            accountNumber: account.accountRefEnc ? decryptField(account.accountRefEnc) : null,
          }
        : null,
      payments: payments.history(userId),
      moneyRequests: payments.listRequests(userId),
      disputes: ops.listDisputes(userId),
      beneficiaries: (store.data.beneficiaries || {})[userId] || null,
      devices,
      sessions,
      waitlist,
      notes: [
        "Amounts are integer minor units (paise); 'balance' fields are also given in rupees.",
        "AML monitoring records are excluded from self-serve export: disclosure to the data principal is prohibited (PMLA tipping-off) and exempt under DPDP \u00a717.",
        "Tamper-evident audit/ledger chains retain pseudonymous transaction records as required by PMLA/RBI even after account closure.",
        "For grievances or lawful correction of anything in this export, use POST /api/account/profile or the grievance contact in the Privacy Policy.",
      ],
    };
  });

  // ---- Profile correction (DPDP right to correction) ----------------------
  // Corrects identity attributes (fullName / country). Because these feed the
  // KYC decision, a change re-runs KYC against the corrected identity and the
  // correction is recorded in the tamper-evident audit log.
  add("POST", /^\/api\/account\/profile$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const u = store.data.users[userId];
    if (!u || u.closed) throw new ApiError(409, "account_closed", "This account is closed");
    await reauth(req, body, userId, "dsr_correction");

    const name = asString(body.fullName, "fullName", { required: false, max: 120 });
    const country = asString(body.country, "country", { required: false, max: 60 });
    if (!name && !country) throw new ApiError(400, "nothing_to_update", "Provide fullName and/or country to correct");

    const fields = [];
    if (name && name !== u.name) { u.name = name; fields.push("name"); }
    if (country && country !== u.country) { u.country = country; fields.push("country"); }
    if (fields.length) {
      u.kyc = runKyc({ fullName: u.name, documentId: "email:" + (u.email || userId), country: u.country || "IN" });
      audit.append("profile_corrected", { userId, fields, kycStatus: u.kyc.status });
      persist();
    }
    return {
      ok: true,
      updated: fields,
      profile: { name: u.name || null, country: u.country || null },
      kyc: u.kyc ? { status: u.kyc.status } : null,
    };
  });
}
