// Localization module — pure JS, unit-tested in test/i18n.test.mjs.
// Provides a minimal but complete i18n foundation:
//   t(key, params?)  — translate with optional {{placeholder}} interpolation
//   setLocale(code) / getLocale() — switch language at runtime
//   detectLocale(deviceCode) — map an OS locale tag to a supported locale
//   isRTL(locale?)  — right-to-left layout check
//   onLocaleChange(cb) / offLocaleChange(cb) — subscribe to locale switches
//
// Only 'en' and 'hi' are shipped. Other locales fall back to 'en'.

const SUPPORTED = new Set(["en", "hi"]);
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);
let _locale = "en";
const _subs = new Set();

const STRINGS = {
  en: {
    // -- Generic
    ok: "OK",
    cancel: "Cancel",
    done: "Done",
    back: "Back",
    close: "Close",
    retry: "Retry",
    loading: "Loading…",
    saving: "Saving…",
    error_generic: "Something went wrong. Please try again.",
    offline: "You appear to be offline.",
    // -- Auth
    sign_in: "Sign in",
    sign_out: "Sign out",
    create_account: "Create account",
    send_reset_code: "Send reset code",
    reset_code: "Reset code",
    unlock: "Unlock",
    unlocking: "Unlocking…",
    continue: "Continue",
    sign_up: "Create account",
    email: "Email address",
    password: "Password",
    totp: "Authenticator code",
    forgot_password: "Forgot password?",
    reset_password: "Reset password",
    new_password: "New password",
    enter_pin: "Enter your PIN",
    set_pin: "Set a PIN",
    confirm_pin: "Confirm PIN",
    pin_mismatch: "PINs don't match — try again.",
    link_bank: "Link bank account",
    account_number: "Account number",
    confirm_account: "Confirm account number",
    account_mismatch: "Account numbers don't match.",
    ifsc: "IFSC code",
    account_holder: "Account holder name",
    // -- Home
    balance: "Balance",
    add_money: "Add money",
    pay: "Pay",
    send: "Send abroad",
    scan: "Scan & pay",
    mobile_recharge: "Recharge",
    pay_bills: "Pay bills",
    activity: "Activity",
    contacts: "Contacts",
    savings: "Growing at {{rate}}% p.a.",
    shortfall: "Add ₹{{amount}} to pay",
    // -- Pay abroad
    who_are_you_paying: "Who are you paying?",
    corridor: "Country",
    amount_inr: "Amount (INR)",
    amount_foreign: "Amount ({{currency}})",
    exchange_rate: "Rate",
    fee: "Fee",
    total_debit: "Total debit",
    get_quote: "Get quote",
    confirm_pay: "Confirm and pay",
    quote_expires_in: "Rate locked for {{sec}}s",
    quote_expired: "Quote expired — fetching a new one…",
    // -- Domestic
    upi_id: "UPI ID",
    mobile_number: "Mobile number",
    note: "Note (optional)",
    send_money: "Send money",
    operator: "Operator",
    bill_category: "Category",
    biller: "Biller",
    consumer_id: "Consumer / account number",
    // -- Review
    review_payment: "Review payment",
    recipient: "Recipient",
    verified_recipient: "Verified recipient",
    unverified_recipient: "Unverified — check details carefully",
    amount: "Amount",
    they_receive: "They receive",
    rate: "Rate (mid-market, no markup)",
    funding_account: "From",
    settlement_status: "Settlement",
    authorize: "Authorize",
    // -- Auth/settle
    authorizing: "Authorizing…",
    settling: "Settling payment",
    settle_step_sending: "Sending",
    settle_step_routing: "Routing",
    settle_step_confirming: "Confirming",
    settle_step_recording: "Recording",
    settle_step_complete: "Complete",
    settle_failed: "Payment failed",
    settle_retry: "Try again",
    // -- Receipt
    receipt: "Receipt",
    share_receipt: "Share receipt",
    verify_receipt: "Verify independently",
    tech_details: "Technical verification details",
    settlement_hash: "Ledger hash",
    public_anchor: "Public anchor",
    signature: "Signature",
    get_help: "Get help",
    report_fraud: "Report fraud",
    dispute: "Dispute payment",
    // -- Activity
    no_activity: "No payments yet.",
    search_activity: "Search payments",
    filter_all: "All",
    filter_domestic: "India",
    filter_international: "Abroad",
    filter_topup: "Top-ups",
    filter_bills: "Bills",
    export_csv: "Export CSV",
    txn_detail: "Payment details",
    // -- Help
    help: "Help",
    help_title: "How can we help?",
    dispute_title: "Dispute this payment",
    describe_issue: "Describe the issue",
    submit: "Submit",
    // -- Validation errors (user-facing)
    amount_empty: "Please enter an amount.",
    amount_invalid: "Please enter a valid amount.",
    amount_too_small: "Minimum amount is ₹1.",
    amount_too_large: "Amount exceeds the maximum limit.",
    amount_exceeds_balance: "Insufficient balance.",
    vpa_invalid: "Please enter a valid UPI ID (e.g. name@bank).",
    ifsc_invalid: "Please enter a valid IFSC code.",
    phone_invalid: "Please enter a valid 10-digit Indian mobile number.",
    account_invalid: "Account number must be 9–18 digits.",
    name_invalid: "Please enter the account holder's name.",
    consumer_invalid: "Please enter a valid consumer / account number.",
    // -- Misc
    app_version: "Version {{version}}",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    close_account: "Close account",
    tagline: "Borderless payments, at home and abroad",
    verify_badge: "Verified",
  },
  hi: {
    // -- Generic
    ok: "ठीक है",
    cancel: "रद्द करें",
    done: "हो गया",
    back: "वापस",
    close: "बंद करें",
    retry: "फिर कोशिश करें",
    loading: "लोड हो रहा है…",
    saving: "सेव हो रहा है…",
    error_generic: "कुछ गलत हो गया। कृपया पुनः प्रयास करें।",
    offline: "आप ऑफ़लाइन लगते हैं।",
    // -- Auth
    sign_in: "साइन इन करें",
    sign_out: "साइन आउट",
    create_account: "खाता बनाएं",
    send_reset_code: "रीसेट कोड भेजें",
    reset_code: "रीसेट कोड",
    unlock: "अनलॉक करें",
    unlocking: "अनलॉक हो रहा है…",
    continue: "जारी रखें",
    sign_up: "खाता बनाएं",
    email: "ईमेल पता",
    password: "पासवर्ड",
    totp: "ऑथेंटिकेटर कोड",
    forgot_password: "पासवर्ड भूल गए?",
    reset_password: "पासवर्ड रीसेट करें",
    new_password: "नया पासवर्ड",
    enter_pin: "अपना PIN डालें",
    set_pin: "PIN सेट करें",
    confirm_pin: "PIN कन्फ़र्म करें",
    pin_mismatch: "PIN मेल नहीं खाते — फिर कोशिश करें।",
    link_bank: "बैंक खाता जोड़ें",
    account_number: "खाता नंबर",
    confirm_account: "खाता नंबर कन्फ़र्म करें",
    account_mismatch: "खाता नंबर मेल नहीं खाते।",
    ifsc: "IFSC कोड",
    account_holder: "खाताधारक का नाम",
    // -- Home
    balance: "शेष",
    add_money: "पैसे जोड़ें",
    pay: "भुगतान",
    send: "विदेश भेजें",
    scan: "स्कैन करें",
    mobile_recharge: "रिचार्ज",
    pay_bills: "बिल भुगतान",
    activity: "गतिविधि",
    contacts: "संपर्क",
    savings: "{{rate}}% प्र.व. की दर से बढ़ रहा",
    shortfall: "इस भुगतान के लिए ₹{{amount}} जोड़ें",
    // -- Pay abroad
    who_are_you_paying: "किसे भुगतान कर रहे हैं?",
    corridor: "देश",
    amount_inr: "राशि (₹)",
    amount_foreign: "राशि ({{currency}})",
    exchange_rate: "विनिमय दर",
    fee: "शुल्क",
    total_debit: "कुल डेबिट",
    get_quote: "दर पता करें",
    confirm_pay: "भुगतान कन्फ़र्म करें",
    quote_expires_in: "{{sec}} सेकंड में दर समाप्त",
    quote_expired: "दर समाप्त — नई दर ला रहे हैं…",
    // -- Domestic
    upi_id: "UPI ID",
    mobile_number: "मोबाइल नंबर",
    note: "टिप्पणी (वैकल्पिक)",
    send_money: "पैसे भेजें",
    operator: "ऑपरेटर",
    bill_category: "श्रेणी",
    biller: "बिलर",
    consumer_id: "उपभोक्ता / खाता नंबर",
    // -- Review
    review_payment: "भुगतान की जांच करें",
    recipient: "प्राप्तकर्ता",
    verified_recipient: "सत्यापित प्राप्तकर्ता",
    unverified_recipient: "असत्यापित — विवरण ध्यान से जांचें",
    amount: "राशि",
    they_receive: "उन्हें मिलता है",
    rate: "दर (बाजार दर, कोई मार्कअप नहीं)",
    funding_account: "खाते से",
    settlement_status: "सेटलमेंट",
    authorize: "भुगतान भेजें",
    // -- Auth/settle
    authorizing: "स्वीकृति हो रही है…",
    settling: "भुगतान सेटल हो रहा है",
    settle_step_sending: "भेज रहे हैं",
    settle_step_routing: "राउट कर रहे हैं",
    settle_step_confirming: "पुष्टि हो रही है",
    settle_step_recording: "रिकॉर्ड हो रहा है",
    settle_step_complete: "पूर्ण",
    settle_failed: "भुगतान विफल",
    settle_retry: "पुनः प्रयास करें",
    // -- Receipt
    receipt: "रसीद",
    share_receipt: "रसीद शेयर करें",
    verify_receipt: "स्वतंत्र रूप से सत्यापित करें",
    tech_details: "तकनीकी सत्यापन विवरण",
    settlement_hash: "लेजर हैश",
    public_anchor: "पब्लिक एंकर",
    signature: "हस्ताक्षर",
    get_help: "मदद लें",
    report_fraud: "धोखाधड़ी रिपोर्ट करें",
    dispute: "भुगतान विवादित करें",
    // -- Activity
    no_activity: "अभी तक कोई भुगतान नहीं।",
    search_activity: "भुगतान खोजें",
    filter_all: "सभी",
    filter_domestic: "भारत",
    filter_international: "विदेश",
    filter_topup: "टॉप-अप",
    filter_bills: "बिल",
    export_csv: "CSV निर्यात करें",
    txn_detail: "भुगतान विवरण",
    // -- Help
    help: "मदद",
    help_title: "हम कैसे मदद करें?",
    dispute_title: "यह भुगतान विवादित करें",
    describe_issue: "समस्या का विवरण दें",
    submit: "जमा करें",
    // -- Validation errors
    amount_empty: "कृपया राशि दर्ज करें।",
    amount_invalid: "कृपया सही राशि दर्ज करें।",
    amount_too_small: "न्यूनतम राशि ₹1 है।",
    amount_too_large: "राशि अधिकतम सीमा से अधिक है।",
    amount_exceeds_balance: "शेष राशि अपर्याप्त है।",
    vpa_invalid: "सही UPI ID दर्ज करें (उदा.: name@bank)।",
    ifsc_invalid: "सही IFSC कोड दर्ज करें।",
    phone_invalid: "सही 10-अंकीय भारतीय मोबाइल नंबर दर्ज करें।",
    account_invalid: "खाता नंबर 9-18 अंक का होना चाहिए।",
    name_invalid: "खाताधारक का नाम दर्ज करें।",
    consumer_invalid: "सही उपभोक्ता / खाता नंबर दर्ज करें।",
    // -- Misc
    app_version: "संस्करण {{version}}",
    terms: "सेवा शर्तें",
    privacy: "गोपनीयता नीति",
    close_account: "खाता बंद करें",
    tagline: "देश में और विदेश में — बिना सरहद भुगतान",
    verify_badge: "सत्यापित",
  },
};

export function detectLocale(deviceCode) {
  if (!deviceCode) return "en";
  const base = String(deviceCode).split(/[-_]/)[0].toLowerCase();
  return SUPPORTED.has(base) ? base : "en";
}

export function setLocale(code) {
  const next = detectLocale(code);
  if (next === _locale) return;
  _locale = next;
  for (const cb of _subs) {
    try { cb(_locale); } catch { /* */ }
  }
}

export function getLocale() { return _locale; }

export function isRTL(locale) {
  return RTL_LOCALES.has((locale || _locale).split("-")[0].toLowerCase());
}

export function onLocaleChange(cb) { _subs.add(cb); }
export function offLocaleChange(cb) { _subs.delete(cb); }

export function t(key, params) {
  const dict = STRINGS[_locale] || STRINGS.en;
  const fallback = STRINGS.en;
  let str = dict[key] !== undefined ? dict[key] : (fallback[key] !== undefined ? fallback[key] : key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
    }
  }
  return str;
}
