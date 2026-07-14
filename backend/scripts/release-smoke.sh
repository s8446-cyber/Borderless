#!/usr/bin/env bash
# Borderless Pay — release smoke test.
# Runs a full user journey + trust checks against a RUNNING deployment.
#   ./scripts/release-smoke.sh http://localhost:4000 [METRICS_TOKEN]
# Exits non-zero on the first failure. Safe to run on the demo product
# (creates demo users; no real money exists anywhere in V1).
set -euo pipefail
BASE="${1:?usage: release-smoke.sh <base-url> [metrics-token]}"
MTOK="${2:-}"

PASS=0; FAIL=0
say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  ✓ $*"; }
die()  { say "  ✗ FAIL: $*"; exit 1; }
json() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const v=('$1').split('.').reduce((o,k)=>o&&o[k],j);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('')}})"; }
req()  { curl -sS --max-time 15 "$@"; }

say "Borderless Pay release smoke → $BASE"
say ""
say "[1/9] Liveness & integrity"
[ "$(req "$BASE/api/health" | json ok)" = "true" ] || die "health"
ok "health"
[ "$(req "$BASE/api/ready" | json ready)" = "true" ] || die "ready (ledger/audit integrity)"
ok "ready — ledger + audit chains verify"
req -o /dev/null -w '%{http_code}' "$BASE/" | grep -q 200 || die "web app"
ok "web app served"
req "$BASE/verify.html" | grep -q "Public receipt verifier" || die "verify.html"
ok "public verifier page served"

say "[2/9] Security headers"
H=$(req -D - -o /dev/null "$BASE/api/health")
echo "$H" | grep -qi "content-security-policy" || die "CSP header missing"
echo "$H" | grep -qi "x-frame-options: DENY" || die "X-Frame-Options missing"
echo "$H" | grep -qi "x-content-type-options: nosniff" || die "nosniff missing"
ok "CSP + frame + sniff protections present"

say "[3/9] Signup (email+password), consent & session"
EMAIL="smoke-$(date +%s)@release.test"
# consent is REQUIRED — signup without it must be refused
CODE=$(req -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"release-smoke-pw1\",\"fullName\":\"Release Smoke\"}")
[ "$CODE" = "400" ] || die "signup without consent must be 400 (got $CODE)"
ok "signup refused without Terms/Privacy consent"
R=$(req -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"release-smoke-pw1\",\"fullName\":\"Release Smoke\",\"consent\":true,\"deviceId\":\"smoke-device\"}")
TOK=$(echo "$R" | json token); RTK=$(echo "$R" | json refreshToken)
[ -n "$TOK" ] && [ -n "$RTK" ] || die "signup did not issue tokens: $R"
[ "$(echo "$R" | json kyc.status)" = "verified" ] || die "kyc stub"
ok "signup issues session + refresh token"
A() { req "$@" -H "authorization: Bearer $TOK" -H "x-device-id: smoke-device"; }
CODE=$(req -o /dev/null -w '%{http_code}' "$BASE/api/accounts" -H "authorization: Bearer $TOK" -H "x-device-id: wrong-device")
[ "$CODE" = "401" ] || die "device binding not enforced (got $CODE)"
ok "device binding enforced (wrong device → 401)"

say "[4/9] Bank link & domestic payment (₹0 fee)"
R=$(A -X POST "$BASE/api/accounts/link" -H 'content-type: application/json' -d '{"bank":"HDFC Bank","pin":"4321"}')
[ "$(echo "$R" | json balance)" = "250000" ] || die "link: $R"
ok "bank linked, opening balance ₹2,50,000"
R=$(A -X POST "$BASE/api/upi/pay" -H 'content-type: application/json' -H "idempotency-key: smoke-upi-1" \
  -d '{"amount":250,"pin":"4321","payee":{"name":"Smoke Payee","kind":"upi"}}')
[ "$(echo "$R" | json receipt.status)" = "settled" ] || die "upi pay: $R"
[ "$(echo "$R" | json receipt.feeMinor)" = "0" ] || die "domestic fee must be 0"
ok "domestic payment settled, fee ₹0"
R2=$(A -X POST "$BASE/api/upi/pay" -H 'content-type: application/json' -H "idempotency-key: smoke-upi-1" \
  -d '{"amount":250,"pin":"4321","payee":{"name":"Smoke Payee","kind":"upi"}}')
[ "$(echo "$R2" | json replayed)" = "true" ] || die "idempotency replay"
ok "idempotent replay — no double charge"

say "[5/9] Cross-border payment (0.5%, no markup) + Merkle proof"
Q=$(req -X POST "$BASE/api/quotes" -H 'content-type: application/json' -d '{"currency":"AED","localAmount":80}')
[ "$(echo "$Q" | json fxMarkupMinor)" = "0" ] || die "fx markup must be 0"
QID=$(echo "$Q" | json quoteId)
R=$(A -X POST "$BASE/api/payments" -H 'content-type: application/json' -d "{\"quoteId\":\"$QID\",\"pin\":\"4321\",\"merchant\":{\"name\":\"Smoke Cafe\",\"country\":\"AE\"}}")
IDX=$(echo "$R" | json receipt.settlement.index); HASH=$(echo "$R" | json receipt.settlement.hash)
[ -n "$IDX" ] && [ -n "$HASH" ] || die "intl payment: $R"
ok "cross-border payment settled (block $IDX)"
P=$(req "$BASE/api/ledger/proof/$IDX")
[ "$(echo "$P" | json blockHash)" = "$HASH" ] || die "proof hash mismatch"
ok "public Merkle proof matches the receipt (unauthenticated)"

say "[6/9] Wrong PIN & security behaviors"
CODE=$(A -o /dev/null -w '%{http_code}' -X POST "$BASE/api/upi/pay" -H 'content-type: application/json' \
  -d '{"amount":10,"pin":"9999","payee":{"name":"X","kind":"upi"}}')
[ "$CODE" = "401" ] || die "wrong PIN accepted ($CODE)"
ok "wrong PIN rejected"

say "[7/9] Refresh rotation, logout & theft response"
R=$(req -X POST "$BASE/api/sessions/refresh" -H 'content-type: application/json' -d "{\"refreshToken\":\"$RTK\",\"deviceId\":\"smoke-device\"}")
NEWTOK=$(echo "$R" | json token); NEWRTK=$(echo "$R" | json refreshToken)
[ -n "$NEWTOK" ] && [ -n "$NEWRTK" ] || die "refresh rotation: $R"
ok "refresh token rotates"
# logout the freshly rotated session (before we trip the theft response below)
TOK="$NEWTOK"
CODE=$(A -o /dev/null -w '%{http_code}' -X POST "$BASE/api/logout")
[ "$CODE" = "200" ] || die "logout ($CODE)"
CODE=$(A -o /dev/null -w '%{http_code}' "$BASE/api/accounts")
[ "$CODE" = "401" ] || die "token alive after logout"
ok "logout revokes the session server-side"
# reusing the OLD (rotated) refresh token is a theft signal → rejected
CODE=$(req -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sessions/refresh" -H 'content-type: application/json' -d "{\"refreshToken\":\"$RTK\",\"deviceId\":\"smoke-device\"}")
[ "$CODE" = "401" ] || die "rotated-token reuse must be rejected ($CODE)"
ok "reuse of rotated refresh token rejected (theft signal)"

say "[8/9] Ledger & audit verification endpoints"
[ "$(req "$BASE/api/ledger/verify" | json ok)" = "true" ] || die "ledger verify"
[ "$(req "$BASE/api/audit/verify" | json ok)" = "true" ] || die "audit verify"
ok "chains verify after all activity"

say "[9/9] Metrics"
if [ -n "$MTOK" ]; then
  CODE=$(req -o /dev/null -w '%{http_code}' "$BASE/api/metrics")
  [ "$CODE" = "401" ] || [ "$CODE" = "404" ] || die "metrics must be gated without token ($CODE)"
  req "$BASE/api/metrics" -H "authorization: Bearer $MTOK" | grep -q "bp_payments_settled_total" || die "metrics with token"
  ok "metrics gated + scrapeable with token"
else
  say "  • metrics token not provided — skipped (set BP_METRICS_TOKEN and pass it to test)"
fi

say ""
say "ALL CHECKS PASSED ($PASS assertions) — deployment is release-healthy. 🌍"
