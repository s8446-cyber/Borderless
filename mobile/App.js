// Borderless Pay — React Native (Expo) app. Android + iOS.
// Redesigned UI (premium dark fintech) over the same backend wiring: pay abroad,
// send abroad (P2P), domestic UPI (phone / UPI ID / bank / scan), bills, recharge,
// request money, contacts, and ledger verification.
import React, { useState, useEffect, useRef } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  StyleSheet,
  Linking,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import { CameraView, useCameraPermissions, WebQrScanner, webCameraCapable } from "./src/scanner";
import * as Contacts from "expo-contacts";
import * as Notifications from "expo-notifications";
import { appAlert, AlertHost, simulateBiometric, getSimPerm, requestSimPerm } from "./src/alert";
import { C, TINTS, CORRIDORS, P2P_CURRENCIES, OPERATORS, BILL_CATEGORIES, BILLERS } from "./src/theme";
import { fmtINR } from "./src/format";
import { api, setSession } from "./src/api";
import { CONFIG } from "./src/config";
import { getDeviceId } from "./src/device";
import { foldMerkleProof } from "./src/sha256";
import { parseUpiQr } from "./src/upi";
import { rs, CONTENT } from "./src/responsive";

// Version stamp (from package.json, inlined by Metro). Shown on the welcome
// screen so it's always obvious WHICH build is installed — if the number on
// screen doesn't match the repo, you're running a stale build (see README:
// "Seeing an old version?").
const APP_VERSION = require("./package.json").version;
import { Brand, Card, Row, Pill, Badges, PrimaryButton, Chips, PinDots, PinPad, SectionHeader, Avatar } from "./src/ui";

// On web (react-native-web / `npm run sim`) the native OS layer — alerts,
// biometric sheet, permission prompts, live camera — isn't available, so those
// interactions are faithfully simulated on screen. Native devices use the real
// thing. This flag is the single switch between the two.
const IS_WEB = Platform.OS === "web";

const SETTLE_STEPS = [
  "Debit home bank account",
  "Write to settlement ledger (hash-chained)",
  "Anchor proof to public chain (Merkle)",
  "Sign authorization (HMAC)",
  "Pay merchant in local currency",
];

const SEND_STEPS = [
  "Debit home bank account",
  "Write to settlement ledger (hash-chained)",
  "Anchor proof to public chain (Merkle)",
  "Sign authorization (HMAC)",
  "Credit recipient in local currency",
];

const DOMESTIC_STEPS = [
  "Verify payee (UPI / IMPS)",
  "Debit bank account",
  "Write to settlement ledger (hash-chained)",
  "Sign authorization (HMAC)",
  "Credit payee instantly",
];

const EMPTY_FORM = {
  payeeName: "",
  phone: "",
  vpa: "",
  account: "",
  ifsc: "",
  amount: "",
  note: "",
  operator: "Airtel",
  billCategory: "Electricity",
  biller: "",
  consumerId: "",
};

function symFor(code) {
  const x = P2P_CURRENCIES.find((p) => p.code === code);
  return x ? x.sym : code;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function initials(name) {
  const n = (name || "").trim();
  if (!n) return "AS";
  const parts = n.split(/\s+/);
  return ((parts[0][0] || "") + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

function txnIcon(p) {
  if (p.kind === "p2p") return "💸";
  if (p.kind === "payment") return "🧳";
  if (p.kind === "bill") return "🧾";
  if (p.kind === "recharge") return "📲";
  if (p.kind === "request") return "🔁";
  return "✅";
}

function txnName(p) {
  if (p.domestic) return p.payee ? p.payee.name : "Payment";
  if (p.kind === "p2p") return p.recipient ? p.recipient.name : "Transfer";
  return p.merchant ? p.merchant.name : "Merchant";
}

function receiptPayeeName(r) {
  if (r.domestic) return "to " + (r.payee ? r.payee.name : "payee");
  if (r.kind === "p2p") return "to " + (r.recipient ? r.recipient.name : "recipient");
  return "to " + (r.merchant ? r.merchant.name : "merchant");
}

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [name, setName] = useState("");
  const [bank, setBank] = useState("HDFC Bank");
  const [newPin, setNewPin] = useState("");
  const [pin, setPin] = useState("");
  const [corridor, setCorridor] = useState("AED");
  const [account, setAccount] = useState(null);
  const [quote, setQuote] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [history, setHistory] = useState([]);
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [flow, setFlow] = useState("pay");
  const [recipientName, setRecipientName] = useState("");
  const [p2pCurrency, setP2pCurrency] = useState("AED");
  const [sendAmount, setSendAmount] = useState("");
  const [domIntent, setDomIntent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [verifyResult, setVerifyResult] = useState(null);
  const [consent, setConsent] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState([]);
  const [webScan, setWebScan] = useState("idle"); // web-sim scanner: idle | live (real camera) | sim (simulated)
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scanLock = useRef(false);
  const lastBadQr = useRef(0);

  const checkScale = useRef(new Animated.Value(0)).current;

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const c = CORRIDORS[corridor];
  const settleSteps = flow === "send" ? SEND_STEPS : flow === "domestic" ? DOMESTIC_STEPS : SETTLE_STEPS;
  const incomingRequest = requests.find((r) => r.direction === "incoming" && r.status === "pending");

  async function handleKyc() {
    if (!name.trim()) {
      return appAlert("Enter your name", "We verify against a name — please enter yours to continue.");
    }
    if (!consent) {
      return appAlert("Consent needed", "Please read and accept the Terms of Service and Privacy Policy to continue.");
    }
    setBusy(true);
    try {
      const r = await api("/api/kyc/verify", {
        method: "POST",
        body: {
          fullName: name.trim(), documentId: "P" + Date.now(), country: "IN",
          deviceId: await getDeviceId(),
          consent: { tosVersion: "1.0", privacyVersion: "1.0" },
        },
      });
      setSession(r);
      setScreen("link");
    } catch (e) {
      appAlert("Verification failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLink() {
    if (newPin.length !== 4) return appAlert("Set a PIN", "Choose a 4-digit payment PIN first.");
    setBusy(true);
    try {
      await api("/api/accounts/link", {
        method: "POST",
        body: { bank, pin: newPin, openingBalance: 250000 },
      });
      await refresh();
      setScreen("home");
    } catch (e) {
      appAlert("Could not link", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const a = await api("/api/accounts");
    setAccount(a);
    const h = await api("/api/payments");
    setHistory(h.payments || []);
    try {
      const cts = await api("/api/contacts");
      setContacts(cts.contacts || []);
      const rq = await api("/api/requests");
      setRequests(rq.requests || []);
    } catch (e) {
      // contacts/requests optional
    }
  }

  function startScan() {
    setFlow("pay");
    setScanning(true);
    setScreen("scan");
    setTimeout(() => setScanning(false), 1700);
  }

  function startSend() {
    setFlow("send");
    setRecipientName("");
    setSendAmount("");
    setP2pCurrency("AED");
    setScreen("send");
  }

  async function getTransferQuote() {
    const amt = Number(sendAmount);
    if (!(amt > 0)) return appAlert("Enter an amount", "How much would you like to send?");
    setBusy(true);
    try {
      const q = await api("/api/transfers/quote", {
        method: "POST",
        body: { recipientCurrency: p2pCurrency, sendAmount: amt },
      });
      setQuote(q);
      setScreen("quote");
    } catch (e) {
      appAlert("Quote failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  function startScanDomestic() {
    setForm(EMPTY_FORM);
    setFlow("domestic");
    scanLock.current = false;
    setWebScan("idle");
    setScreen("scanDom");
  }

  // A real merchant UPI QR payload for the simulated scanner — it goes through
  // the SAME hardened upi:// parser as a physical QR, so the full pipeline
  // (parse → validate → prefill) is exercised even without a camera.
  const DEMO_UPI_QR = "upi://pay?pa=ccd@bpl&pn=Cafe%20Coffee%20Day";

  // Web: scan the way a phone browser would. If the browser can open a camera
  // (secure context + getUserMedia — e.g. the sim opened on a phone, or a
  // laptop with a webcam), use the REAL camera: the browser shows its own
  // in-context permission prompt and frames are decoded on-device
  // (BarcodeDetector on phones, bundled jsQR elsewhere). Only when no camera
  // API exists do we fall back to a clearly-simulated scan.
  async function startWebScan() {
    if (webCameraCapable()) {
      scanLock.current = false;
      setWebScan("live"); // <WebQrScanner/> mounts → browser permission prompt
      return;
    }
    if (getSimPerm("camera") === "denied") {
      return appAlert(
        "Camera access is turned off",
        "You declined camera access this session, so scanning is unavailable. You can still pay with the demo QR or by entering a UPI ID. (Reload the page to be asked again.)"
      );
    }
    const ok = await requestSimPerm("camera", {
      icon: "📷",
      title: "“Borderless Pay” Would Like to Access the Camera",
      message: "Borderless Pay uses the camera only while you scan a payment QR code. Photos and video are never captured or stored.",
    });
    if (!ok) {
      return appAlert("Camera off", "No problem — use the demo QR, or enter a UPI ID instead.");
    }
    simScan();
  }

  // Simulated scan: brief scanning animation, then a demo UPI QR payload is
  // fed through the real onQrScanned → parseUpiQr pipeline.
  function simScan() {
    setWebScan("sim");
    setTimeout(() => {
      setWebScan("idle");
      onQrScanned({ data: DEMO_UPI_QR });
    }, 1700);
  }

  // The real web camera failed to start.
  function onWebCamError(e) {
    setWebScan("idle");
    const name = e && e.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      appAlert(
        "Camera access is turned off",
        "You denied the browser's camera permission, so live scanning is unavailable. Enable it in your browser's site settings, or continue with the demo QR / manual entry."
      );
    } else {
      appAlert("Camera unavailable", "No usable camera was found — continuing with the simulated scanner.", [
        { text: "OK", onPress: simScan },
      ]);
    }
  }

  // Real QR handling: parse the (untrusted) QR payload as a UPI URI; valid →
  // prefill the payment review screen; invalid → hint and keep scanning.
  function onQrScanned({ data }) {
    if (scanLock.current) return;
    const parsed = parseUpiQr(data);
    if (!parsed) {
      if (Date.now() - lastBadQr.current > 2500) {
        lastBadQr.current = Date.now();
        appAlert("Not a UPI payment QR", "Point the camera at a UPI QR (it encodes upi://pay…). You can also enter the UPI ID manually.");
      }
      return;
    }
    scanLock.current = true;
    setForm({
      ...EMPTY_FORM,
      payeeName: parsed.name,
      vpa: parsed.vpa,
      amount: parsed.amount ? String(parsed.amount) : "",
      note: parsed.note,
    });
    setDomIntent({ kind: "upiid", title: parsed.name, sub: parsed.vpa + " • Scanned QR" });
    setScreen("compose");
  }

  // Fallback for emulators / web / denied camera: the demo merchant QR.
  function useDemoQr() {
    setForm({ ...EMPTY_FORM, payeeName: "Cafe Coffee Day" });
    setDomIntent({ kind: "merchant", title: "Cafe Coffee Day", sub: "ccd@bpl • Demo QR" });
    setScreen("compose");
  }

  function startDom(kind) {
    setForm(EMPTY_FORM);
    const map = {
      phone: { title: "Pay by phone number", sub: "Sends instantly via UPI" },
      upiid: { title: "Pay to UPI ID", sub: "e.g. name@bank" },
      bank: { title: "Bank transfer", sub: "To any account + IFSC (IMPS / NEFT)" },
      recharge: { title: "Mobile recharge", sub: "Prepaid top-up" },
      bill: { title: "Pay bills", sub: "Electricity, water, gas, broadband & more" },
      request: { title: "Request money", sub: "Ask someone to pay you" },
    };
    const m = map[kind] || { title: "Pay", sub: "" };
    setDomIntent({ kind, title: m.title, sub: m.sub });
    setScreen("compose");
  }

  function payContact(ct) {
    setForm({ ...EMPTY_FORM, payeeName: ct.name, phone: ct.phone, vpa: ct.vpa });
    setDomIntent({ kind: "contact", title: "Pay " + ct.name, sub: ct.vpa || ct.phone });
    setScreen("compose");
  }

  // Real OS contacts permission — asked IN-CONTEXT, only when the user taps
  // "Pay a contact from my phone". A priming Alert explains why BEFORE the OS
  // Allow/Deny dialog; deny → the built-in demo contacts remain usable, so the
  // feature degrades gracefully and never nags.
  async function payFromPhoneContacts() {
    // Web sim: show the OS-style contacts prompt, then (on allow) load the
    // built-in directory as if it were the phone's contacts. Asked once and
    // remembered for the session, like the OS.
    if (IS_WEB) {
      if (getSimPerm("contacts") === "denied") {
        return appAlert(
          "Contacts access is off",
          "You declined contacts access this session. Enter a UPI ID / phone number instead, or reload the page to be asked again.",
          [{ text: "Enter manually", onPress: () => startDom("phone") }, { text: "Cancel", style: "cancel" }]
        );
      }
      const ok = await requestSimPerm("contacts", {
        icon: "👥",
        title: "“Borderless Pay” Would Like to Access Your Contacts",
        message: "Borderless Pay reads your contacts only to let you pick who to pay. Matching happens on your device — your contact list is never uploaded or stored.",
      });
      if (!ok) {
        return appAlert("No problem", "You can still pay by entering a UPI ID or phone number.", [{ text: "Enter manually", onPress: () => startDom("phone") }, { text: "OK", style: "cancel" }]);
      }
      return loadPhoneContactsWeb();
    }
    const { status, canAskAgain } = await Contacts.getPermissionsAsync();
    if (status !== "granted") {
      if (!canAskAgain) {
        return appAlert(
          "Contacts access is off",
          "You've turned off contacts access. Enable it in Settings to pick a contact, or just enter a UPI ID / phone number instead.",
          [{ text: "Enter manually", onPress: () => startDom("phone") }, { text: "Open settings", onPress: () => Linking.openSettings() }, { text: "Cancel", style: "cancel" }]
        );
      }
      appAlert(
        "Pay a contact",
        "Borderless Pay will read your contacts only to let you pick who to pay. Matching happens on your device — your contact list is never uploaded or stored.",
        [
          { text: "Not now", style: "cancel" },
          {
            text: "Continue",
            onPress: async () => {
              const res = await Contacts.requestPermissionsAsync(); // the real OS Allow/Deny pop-up
              if (res.status === "granted") loadPhoneContacts();
              else appAlert("No problem", "You can still pay by entering a UPI ID or phone number.", [{ text: "OK", onPress: () => startDom("phone") }]);
            },
          },
        ]
      );
      return;
    }
    loadPhoneContacts();
  }

  async function loadPhoneContacts() {
    try {
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const withPhones = (data || []).filter((c) => c.name && c.phoneNumbers && c.phoneNumbers.length);
      if (!withPhones.length) return appAlert("No contacts found", "Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]);
      setPhoneContacts(withPhones.slice(0, 50));
      setScreen("contacts");
    } catch (e) {
      appAlert("Could not read contacts", "Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]);
    }
  }

  // Web sim: build a phone-contacts list (expo-contacts shape) from the
  // built-in demo directory so the "pick a contact" screen works in a browser.
  async function loadPhoneContactsWeb() {
    try {
      const { contacts } = await api("/api/contacts");
      const mapped = (contacts || []).map((ct, i) => ({ id: "demo-" + i, name: ct.name, phoneNumbers: [{ number: ct.phone }] }));
      if (!mapped.length) return appAlert("No contacts found", "Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]);
      setPhoneContacts(mapped);
      setScreen("contacts");
    } catch (e) {
      appAlert("Could not read contacts", "Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]);
    }
  }

  function payPhoneContact(c) {
    const phone = c.phoneNumbers[0].number;
    setForm({ ...EMPTY_FORM, payeeName: c.name, phone });
    setDomIntent({ kind: "phone", title: "Pay " + c.name, sub: phone });
    setScreen("compose");
  }

  // Real OS notifications permission — offered ONCE after the first successful
  // payment (never at launch), and fully optional.
  async function maybeOfferNotifications() {
    // Web sim: offer the OS-style notifications prompt ONCE after the first
    // successful payment — the answer is remembered, so it never nags.
    if (IS_WEB) {
      if (getSimPerm("notifications") !== "undetermined") return;
      const ok = await requestSimPerm("notifications", {
        icon: "🔔",
        title: "“Borderless Pay” Would Like to Send You Notifications",
        message: "Get an instant receipt and a security alert for every payment. Optional — the app works fully without it.",
      });
      if (ok) appAlert("Alerts on", "You'll get a receipt and a security alert for each payment.");
      return;
    }
    try {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status === "granted" || !canAskAgain) return;
      appAlert(
        "Payment alerts?",
        "Get an instant receipt and a security alert for every payment. Optional — the app works fully without it.",
        [
          { text: "No thanks", style: "cancel" },
          { text: "Enable alerts", onPress: () => Notifications.requestPermissionsAsync() }, // real OS Allow/Deny pop-up
        ]
      );
    } catch (e) { /* notifications unavailable — silently skip */ }
  }

  function payIncomingRequest(r) {
    setForm({ ...EMPTY_FORM, amount: String(r.amount) });
    setDomIntent({ kind: "payrequest", requestId: r.id, title: "Pay request", sub: r.fromName + (r.note ? " • " + r.note : "") });
    setFlow("domestic");
    openAuth();
  }

  async function submitRequest() {
    const amount = Number(form.amount);
    if (!(amount > 0)) return appAlert("Enter an amount", "How much do you want to request?");
    setBusy(true);
    try {
      await api("/api/requests", {
        method: "POST",
        body: { amount, fromName: form.payeeName || form.phone || "Someone", note: form.note },
      });
      await refresh();
      appAlert("Request sent", "We'll notify you when it's paid.");
      setScreen("home");
    } catch (e) {
      appAlert("Could not send request", e.message);
    } finally {
      setBusy(false);
    }
  }

  function proceedDomestic() {
    const amount = Number(form.amount);
    if (!(amount > 0)) return appAlert("Enter an amount", "How much do you want to pay?");
    setFlow("domestic");
    openAuth();
  }

  function buildDomesticRequest() {
    const amount = Number(form.amount);
    const k = domIntent ? domIntent.kind : "upi";
    if (k === "payrequest") return { endpoint: "/api/requests/pay", body: { requestId: domIntent.requestId } };
    if (k === "recharge") return { endpoint: "/api/recharge", body: { amount, recharge: { operator: form.operator, number: form.phone, plan: "Custom" } } };
    if (k === "bill") return { endpoint: "/api/bills/pay", body: { amount, biller: { category: form.billCategory, name: form.biller || form.billCategory, consumerId: form.consumerId } } };
    let payee;
    if (k === "bank") payee = { kind: "bank", type: "bank", name: form.payeeName || "Bank account", account: form.account, ifsc: form.ifsc };
    else if (k === "upiid") payee = { kind: "upi", type: "upi", name: form.payeeName || form.vpa || "UPI ID", vpa: form.vpa };
    else if (k === "phone") payee = { kind: "upi", type: "phone", name: form.payeeName || form.phone || "Payee", phone: form.phone };
    else if (k === "merchant") payee = { kind: "upi", type: "merchant", name: form.payeeName || "Merchant" };
    else payee = { kind: "upi", type: "contact", name: form.payeeName || "Payee", phone: form.phone, vpa: form.vpa };
    return { endpoint: "/api/upi/pay", body: { amount, payee } };
  }

  async function getQuote() {
    setBusy(true);
    try {
      const q = await api("/api/quotes", {
        method: "POST",
        body: { currency: corridor, localAmount: c.amount },
      });
      setQuote(q);
      setScreen("quote");
    } catch (e) {
      appAlert("Quote failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- payment authorization (biometric gate → PIN) ----
  // bioState: "checking" → biometric prompt in progress (PIN pad hidden)
  //           "passed"   → biometric OK (or none enrolled) — PIN pad active
  //           "failed"   → user failed/cancelled — must retry or go back
  const [bioState, setBioState] = useState("checking");
  const authInFlight = useRef(false);

  function authExitScreen() {
    return flow === "domestic" ? (domIntent && domIntent.kind !== "payrequest" ? "compose" : "home") : "quote";
  }

  async function openAuth() {
    setPin("");
    authInFlight.current = false;
    setBioState("checking");
    setScreen("auth");
    await runBiometric();
  }

  async function runBiometric() {
    setBioState("checking");
    // Web sim: browsers have no biometric API, so show a simulated Face ID
    // sheet. The gate is still real — cancelling blocks the PIN pad, exactly
    // as a failed biometric does on a device.
    if (IS_WEB) {
      const result = await simulateBiometric("Confirm it's you to authorize this payment");
      setBioState(result.success ? "passed" : "failed");
      return;
    }
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
      if (!enrolled) {
        setBioState("passed"); // no biometrics on this device — PIN is the factor
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authorize your payment",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });
      // THE GATE IS REAL: a failed or cancelled biometric blocks the PIN pad.
      setBioState(result.success ? "passed" : "failed");
    } catch (e) {
      // hardware error → don't strand the user; PIN (server-verified) remains
      setBioState("passed");
    }
  }

  // PIN entry: the state updater stays PURE (no side effects inside setState —
  // impure updaters can double-fire under React dev double-invocation, which
  // for a payment would mean two idempotency keys = a possible double charge).
  // The 4th digit triggers authorization exactly once via this effect.
  function onPinKey(k) {
    if (bioState !== "passed") return; // pad is inert until the biometric gate opens
    setPin((prev) => (k === "del" ? prev.slice(0, -1) : prev.length < 4 ? prev + k : prev));
  }

  useEffect(() => {
    if (screen !== "auth" || bioState !== "passed" || pin.length !== 4) return;
    if (authInFlight.current) return;
    authInFlight.current = true;
    const t = setTimeout(() => authorize(pin), 150);
    return () => clearTimeout(t);
  }, [pin, screen, bioState]);

  async function authorize(enteredPin) {
    setScreen("settle");
    setStep(0);
    const steps = flow === "send" ? SEND_STEPS : flow === "domestic" ? DOMESTIC_STEPS : SETTLE_STEPS;
    const idem = "idem_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    try {
      let endpoint, body;
      if (flow === "domestic") {
        const built = buildDomesticRequest();
        endpoint = built.endpoint;
        body = { ...built.body, pin: enteredPin };
      } else if (flow === "send") {
        endpoint = "/api/transfers";
        body = { quoteId: quote.quoteId, pin: enteredPin, recipient: { name: recipientName || "Recipient", country: p2pCurrency } };
      } else {
        endpoint = "/api/payments";
        body = { quoteId: quote.quoteId, pin: enteredPin, merchant: { name: c.merchant, country: corridor } };
      }
      const r = await api(endpoint, { method: "POST", idempotencyKey: idem, body });
      setTimeout(async () => {
        setVerifyResult(null);
        setReceipt(r.receipt);
        await refresh();
        setScreen("receipt");
        maybeOfferNotifications(); // in-context, after a real successful payment
      }, steps.length * 520 + 300);
    } catch (e) {
      authInFlight.current = false; // allow a clean retry after any failure
      setPin("");
      // A 60-second quote can lapse while the user hesitates — recover by
      // fetching a fresh one instead of stranding them on a dead quote.
      if (/expired/i.test(e.message || "") && flow !== "domestic") {
        appAlert("Quote expired", "Rates lock for 60 seconds — fetching you a fresh quote.");
        if (flow === "send") getTransferQuote();
        else getQuote();
        return;
      }
      appAlert("Could not complete", e.message);
      setScreen(authExitScreen());
    }
  }

  // Recompute the receipt's Merkle inclusion proof CLIENT-SIDE (pure-JS
  // SHA-256 — no trust in the server/simulator for the math). Works in both
  // demo mode (real hash chain in src/demo.js) and real-backend mode.
  async function verifyReceipt() {
    if (!receipt || !receipt.settlement) return;
    setVerifyResult({ pending: true });
    try {
      const p = await api("/api/ledger/proof/" + receipt.settlement.index);
      if (p.blockHash !== receipt.settlement.hash) throw new Error("ledger block hash does not match this receipt");
      const root = foldMerkleProof(p.blockHash, p.path);
      if (root !== p.anchor.merkleRoot) throw new Error("Merkle path does not reach the anchor root");
      setVerifyResult({
        ok: true,
        message: "Independently verified — committed under anchor " + p.anchor.anchorId + ", published as " + p.anchor.publicTxHash.slice(0, 16) + "…",
      });
    } catch (e) {
      setVerifyResult({ ok: false, message: "Verification failed: " + e.message });
    }
  }

  // Open the hosted policy document. In DEMO mode there is no backend to
  // serve it — canOpenURL would still say "yes" and strand the user on a dead
  // browser tab, so we show the key points inline instead (informed consent
  // either way). Real-backend mode opens the served document, with the same
  // inline fallback if it can't.
  async function openPolicy(doc, title, summary) {
    if (CONFIG.DEMO_MODE) {
      appAlert(title + " (v1.0)", summary);
      return;
    }
    try {
      const supported = await Linking.canOpenURL(CONFIG.API_BASE + "/" + doc);
      if (!supported) throw new Error("unavailable");
      await Linking.openURL(CONFIG.API_BASE + "/" + doc);
    } catch {
      appAlert(title + " (v1.0)", summary);
    }
  }

  const PRIVACY_SUMMARY =
    "We collect only what payments need: your name (and email if you create a login), a hashed device ID for session security, and transaction records. PINs/passwords are stored as scrypt hashes; sensitive fields are AES-256-GCM encrypted. No contacts, location, camera or ad data is collected. You can close your account anytime — profile data is erased; transaction records are kept pseudonymously where law requires. Full policy: privacy.html on the web app.";
  const TERMS_SUMMARY =
    "Demo product — no real money moves. ₹0 domestic fee; cross-border at the mid-market rate + flat 0.5% (₹2 min, ₹500 cap), always shown before you confirm. Receipts are recorded on a tamper-evident ledger. Keep your PIN and 2FA codes secret. Full terms: terms.html on the web app.";

  function confirmLogout() {
    appAlert("Account", "Log out, or close your account permanently?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", onPress: logout },
      {
        text: "Close account",
        style: "destructive",
        onPress: () =>
          appAlert(
            "Close your account?",
            "Your profile data is erased immediately and every session is revoked. Transaction records are retained pseudonymously as required by law. This cannot be undone.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Erase & close", style: "destructive", onPress: closeAccount },
            ]
          ),
      },
    ]);
  }

  async function closeAccount() {
    try {
      await api("/api/account/close", { method: "POST" });
      appAlert("Account closed", "Your profile data has been erased and all sessions revoked.");
    } catch (e) {
      appAlert("Could not close account", e.message);
      return;
    }
    await resetLocal();
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (e) {
      // best effort — local state is cleared regardless
    }
    await resetLocal();
  }

  async function resetLocal() {
    setSession({});
    setAccount(null);
    setHistory([]);
    setRequests([]);
    setContacts([]);
    setReceipt(null);
    setQuote(null);
    setVerifyResult(null);
    setNewPin("");
    setPin("");
    setName("");
    setConsent(false); // a fresh onboarding must re-consent
    setScreen("welcome");
  }

  async function verifyLedger() {
    try {
      const v = await api("/api/ledger/verify");
      appAlert(
        v.ok ? "✓ Ledger intact" : "✗ Tampering detected",
        v.ok ? v.blocks + " blocks • " + v.anchors + " anchors verified" : String(v.reason)
      );
    } catch (e) {
      appAlert("Error", e.message);
    }
  }

  useEffect(() => {
    if (screen !== "settle") return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= settleSteps.length) clearInterval(id);
    }, 520);
    return () => clearInterval(id);
  }, [screen]);

  useEffect(() => {
    if (screen === "receipt") {
      checkScale.setValue(0);
      Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, bounciness: 12, speed: 8 }).start();
    }
  }, [screen]);

  const showTabs = ["home", "scan", "scanDom", "send", "compose", "history", "quote", "receipt", "contacts"].includes(screen);

  return (
    <SafeAreaView style={s.app}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {screen === "welcome" && (
          <View>
            <Brand subtitle="Pay at home & across borders" />
            <Text style={s.h1}>Pay anywhere, straight from your bank.</Text>
            <Text style={s.sub}>
              Spend at home and abroad at the real mid-market rate with a flat 0.5% fee — ₹0 on
              domestic UPI. No wallets, no hidden FX markup, no surprises.
            </Text>
            <Card>
              <Row label="🏦 Direct from your bank" value="✓" accent />
              <Row label="💱 Mid-market FX rate" value="✓" accent />
              <Row label="🔒 Triple-secure ledger" value="✓" accent />
            </Card>
            <Text style={s.label}>Your name</Text>
            <TextInput
              style={s.input}
              placeholder="Aarav Shah"
              placeholderTextColor={C.muted}
              value={name}
              onChangeText={setName}
            />
            <TouchableOpacity style={s.consentRow} activeOpacity={0.8} onPress={() => setConsent(!consent)}>
              <View style={[s.consentBox, consent && s.consentBoxOn]}>
                {consent ? <Text style={[{ color: "#04122b", fontWeight: "800", fontSize: 13 }]}>✓</Text> : null}
              </View>
              <Text style={s.consentTxt}>I agree to the Terms of Service and Privacy Policy (v1.0)</Text>
            </TouchableOpacity>
            <View style={[{ flexDirection: "row", marginLeft: 32, marginBottom: 6 }]}>
              <TouchableOpacity onPress={() => openPolicy("terms.html", "Terms of Service", TERMS_SUMMARY)}>
                <Text style={s.consentLink}>Read the Terms ↗</Text>
              </TouchableOpacity>
              <Text style={[{ color: C.muted, marginHorizontal: 6, fontSize: 12 }]}>·</Text>
              <TouchableOpacity onPress={() => openPolicy("privacy.html", "Privacy Policy", PRIVACY_SUMMARY)}>
                <Text style={s.consentLink}>Privacy Policy ↗</Text>
              </TouchableOpacity>
            </View>
            <PrimaryButton title="Verify identity (KYC) →" onPress={handleKyc} loading={busy} />
            <Text style={s.apiNote}>Calls real POST /api/kyc/verify • consent recorded & versioned</Text>
            <Text style={s.buildStamp}>v{APP_VERSION} · {CONFIG.DEMO_MODE ? "demo mode (standalone)" : "live backend: " + CONFIG.API_BASE}</Text>
          </View>
        )}

        {screen === "link" && (
          <View>
            <Text style={s.h2}>Link your home bank</Text>
            <Text style={s.sub}>
              We connect via secure open-banking consent. Your money stays in your bank until you pay.
            </Text>
            <Text style={s.label}>Bank</Text>
            <Chips
              value={bank}
              onChange={setBank}
              options={[
                { value: "HDFC Bank", label: "HDFC" },
                { value: "ICICI Bank", label: "ICICI" },
                { value: "State Bank of India", label: "SBI" },
                { value: "Axis Bank", label: "Axis" },
              ]}
            />
            <Text style={s.label}>Create a 4-digit payment PIN</Text>
            <PinDots filled={newPin.length} />
            <PinPad onKey={(k) => setNewPin((p) => (k === "del" ? p.slice(0, -1) : p.length < 4 ? p + k : p))} />
            <PrimaryButton title="Link account" onPress={handleLink} loading={busy} />
            <Text style={s.apiNote}>POST /api/accounts/link • PIN stored as scrypt hash</Text>
          </View>
        )}

        {screen === "home" && (
          <View>
            <View style={s.topbar}>
              <View>
                <Text style={s.greet}>{greeting()}</Text>
                <Text style={s.greetName}>{(name ? name.split(" ")[0] : "there") + " 👋"}</Text>
              </View>
              <View style={[{ flexDirection: "row", alignItems: "center" }]}>
                <TouchableOpacity onPress={confirmLogout} activeOpacity={0.7} style={[s.verifyChip, { marginRight: 10 }]}>
                  <Text style={s.verifyChipTxt}>🚪 Log out</Text>
                </TouchableOpacity>
                <Avatar initials={initials(name)} size={46} />
              </View>
            </View>

            <Card glow>
              <Text style={s.muted}>Available to spend</Text>
              <Text style={s.balance}>{fmtINR(account ? account.balance : 0)}</Text>
              <View style={s.balanceRow}>
                <Pill>{account ? account.bank + " • " + account.maskedNumber : "Bank"}</Pill>
                <TouchableOpacity onPress={verifyLedger} activeOpacity={0.7} style={s.verifyChip}>
                  <Text style={s.verifyChipTxt}>🔎 Verify</Text>
                </TouchableOpacity>
              </View>
              <Badges items={["🔐 scrypt PIN", "⛓️ dual ledger", "✍️ HMAC signed"]} />
            </Card>

            {incomingRequest && (
              <Card glow>
                <Text style={[{ color: C.text, fontWeight: "700", marginBottom: 4 }]}>
                  💰 {incomingRequest.fromName} requested {fmtINR(incomingRequest.amount)}
                </Text>
                <Text style={[{ color: C.muted, fontSize: 13, marginBottom: 10 }]}>
                  {incomingRequest.note || "Payment request"}
                </Text>
                <PrimaryButton title={"Pay " + fmtINR(incomingRequest.amount)} onPress={() => payIncomingRequest(incomingRequest)} />
              </Card>
            )}

            <SectionHeader title="Money transfer" />
            <View style={s.grid}>
              <ActionTile icon="📷" label="Scan QR" tint={TINTS.indigo} onPress={startScanDomestic} />
              <ActionTile icon="📱" label="To phone" tint={TINTS.mint} onPress={() => startDom("phone")} />
              <ActionTile icon="🆔" label="To UPI ID" tint={TINTS.violet} onPress={() => startDom("upiid")} />
              <ActionTile icon="🏦" label="To bank" tint={TINTS.slate} onPress={() => startDom("bank")} />
              <ActionTile icon="🔁" label="Request" tint={TINTS.amber} onPress={() => startDom("request")} />
            </View>

            <SectionHeader title="Recharge & bills" />
            <View style={s.grid}>
              <ActionTile icon="📲" label="Recharge" tint={TINTS.mint} onPress={() => startDom("recharge")} />
              <ActionTile icon="🧾" label="Pay bills" tint={TINTS.amber} onPress={() => startDom("bill")} />
              <ActionTile icon="💡" label="Electricity" tint={TINTS.amber} onPress={() => startDom("bill")} />
              <ActionTile icon="📺" label="DTH" tint={TINTS.violet} onPress={() => startDom("bill")} />
            </View>

            <SectionHeader title="International 🌍" />
            <View style={s.grid}>
              <ActionTile icon="💸" label="Send abroad" tint={TINTS.indigo} onPress={startSend} />
              <ActionTile icon="🧳" label="Pay abroad" tint={TINTS.indigo} onPress={startScan} />
              <ActionTile icon="🔎" label="Verify" tint={TINTS.slate} onPress={verifyLedger} />
            </View>

            {contacts.length > 0 && (
              <View>
                <SectionHeader title="People" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[{ marginBottom: 8 }]}>
                  <TouchableOpacity style={s.person} activeOpacity={0.8} onPress={payFromPhoneContacts}>
                    <View style={[s.personAdd]}><Text style={[{ fontSize: 22, color: C.accent }]}>👤+</Text></View>
                    <Text style={s.personName} numberOfLines={1}>From phone</Text>
                  </TouchableOpacity>
                  {contacts.map((ct) => (
                    <TouchableOpacity key={ct.vpa || ct.phone} style={s.person} activeOpacity={0.8} onPress={() => payContact(ct)}>
                      <Avatar initials={ct.initials} size={52} />
                      <Text style={s.personName} numberOfLines={1}>{ct.name.split(" ")[0]}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <SectionHeader title="Recent" action={history.length ? "See all" : null} onAction={async () => { await refresh(); setScreen("history"); }} />
            <HistoryList history={history} />
          </View>
        )}

        {screen === "scan" && (
          <View>
            <Text style={s.h2}>Pay abroad</Text>
            <Text style={s.sub}>Pick a corridor, then scan the local merchant's QR.</Text>
            <Text style={s.label}>Corridor</Text>
            <Chips
              value={corridor}
              onChange={setCorridor}
              options={Object.keys(CORRIDORS).map((k) => ({ value: k, label: CORRIDORS[k].flag + " " + k }))}
            />
            <View style={s.scanner}>
              <View style={s.scanline} />
              <View style={s.qr}>
                {Array.from({ length: 25 }).map((_, i) => (
                  <View key={i} style={[s.qrCell, i % 3 === 0 && { backgroundColor: "#000" }, i % 5 === 0 && { backgroundColor: "#000" }]} />
                ))}
              </View>
            </View>
            {scanning ? (
              <ActivityIndicator color={C.accent} size="large" style={[{ marginTop: 26 }]} />
            ) : (
              <View>
                <Card style={[{ marginTop: 16 }]}>
                  <Row label="Merchant" value={c.merchant} />
                  <Row label="Location" value={c.flag + " " + c.country} />
                  <Row label="Status" value="✓ Demo corridor merchant" accent />
                </Card>
                <PrimaryButton title="Continue" onPress={getQuote} loading={busy} />
              </View>
            )}
          </View>
        )}

        {screen === "send" && (
          <View>
            <Text style={s.h2}>Send money abroad</Text>
            <Text style={s.sub}>
              Send to anyone abroad, straight from your bank at the real mid-market rate.
            </Text>
            <Text style={s.label}>Recipient name</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Sara Khan"
              placeholderTextColor={C.muted}
              value={recipientName}
              onChangeText={setRecipientName}
            />
            <Text style={s.label}>They receive in</Text>
            <Chips
              value={p2pCurrency}
              onChange={setP2pCurrency}
              options={P2P_CURRENCIES.map((x) => ({ value: x.code, label: x.flag + " " + x.code }))}
            />
            <Text style={s.label}>Amount to send (₹ INR)</Text>
            <TextInput
              style={s.input}
              placeholder="1000"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              value={sendAmount}
              onChangeText={setSendAmount}
            />
            <PrimaryButton title="Get quote →" onPress={getTransferQuote} loading={busy} />
          </View>
        )}

        {screen === "quote" && quote && quote.kind === "p2p" && (
          <View>
            <Text style={s.h2}>Confirm transfer</Text>
            <Text style={s.sub}>To {recipientName || "your recipient"}</Text>
            <Card glow>
              <Row label="They receive" value={symFor(quote.recipientCurrency) + " " + quote.recipientAmount.toLocaleString()} accent />
              <Row label="Exchange rate (mid-market)" value={"1 " + quote.recipientCurrency + " = ₹" + quote.rate} />
              <Row label="You send" value={fmtINR(quote.sendAmount)} />
              <Row label="FX markup" value="₹0.00" accent />
              <Row label="Borderless fee (0.5%)" value={fmtINR(quote.fee)} />
              <Row label="Total from bank" value={fmtINR(quote.total)} accent big />
            </Card>
            <Text style={s.savings}>Real rate, no markup — they get every rupee converted fairly.</Text>
            {account && quote.total > account.balance ? (
              <View>
                <Text style={s.shortfall}>Insufficient balance. You have {fmtINR(account.balance)} — this transfer needs {fmtINR(quote.total)}.</Text>
                <PrimaryButton title="Change amount" secondary onPress={() => setScreen("send")} />
              </View>
            ) : (
              <PrimaryButton title="Slide to send 🔒" onPress={openAuth} />
            )}
          </View>
        )}

        {screen === "quote" && quote && quote.kind !== "p2p" && (
          <View>
            <Text style={s.h2}>Confirm payment</Text>
            <Text style={s.sub}>{c.merchant}</Text>
            <Card glow>
              <Row label="They charge" value={c.sym + " " + c.amount.toLocaleString()} />
              <Row label="Exchange rate (mid-market)" value={"1 " + corridor + " = ₹" + quote.rate} accent />
              <Row label="Converted amount" value={fmtINR(quote.amount)} />
              <Row label="FX markup" value="₹0.00" accent />
              <Row label="Borderless fee (0.5%)" value={fmtINR(quote.fee)} />
              <Row label="Total from bank" value={fmtINR(quote.total)} accent big />
            </Card>
            <Text style={s.savings}>
              You save ~{fmtINR(quote.amount * 0.035 + 200 - quote.fee)} vs a typical bank card
            </Text>
            {account && quote.total > account.balance ? (
              <View>
                <Text style={s.shortfall}>Insufficient balance. You have {fmtINR(account.balance)} — this payment needs {fmtINR(quote.total)}.</Text>
                <PrimaryButton title="Back" secondary onPress={() => setScreen("scan")} />
              </View>
            ) : (
              <PrimaryButton title="Slide to pay 🔒" onPress={openAuth} />
            )}
          </View>
        )}

        {screen === "scanDom" && (IS_WEB ? (
          <View>
            <Text style={s.h2}>Scan any UPI QR</Text>
            {webScan === "live" ? (
              <View>
                <View style={s.scanner}>
                  <WebQrScanner onScanned={onQrScanned} onError={onWebCamError} />
                  <View style={s.scanline} pointerEvents="none" />
                </View>
                <Text style={[s.apiNote, { marginTop: 10 }]}>
                  Live camera — point at any UPI QR (it encodes upi://pay…). Decoded on your device; nothing is photographed, stored, or uploaded.
                </Text>
                <PrimaryButton title="Stop camera" secondary onPress={() => setWebScan("idle")} />
                <PrimaryButton title="Enter UPI ID instead" secondary onPress={() => startDom("upiid")} />
                <PrimaryButton title="Use demo QR (no camera)" secondary onPress={useDemoQr} />
              </View>
            ) : webScan === "sim" ? (
              <View>
                <View style={s.scanner}>
                  <View style={[{ flex: 1, alignItems: "center", justifyContent: "center" }]}>
                    <Text style={[{ fontSize: 52 }]}>🎯</Text>
                    <Text style={[{ color: C.muted, marginTop: 8, fontWeight: "600" }]}>Scanning — hold steady…</Text>
                  </View>
                  <View style={s.scanline} pointerEvents="none" />
                </View>
                <Text style={[s.apiNote, { marginTop: 10 }]}>
                  Simulated camera (no camera available here). Detecting a demo UPI QR — it runs through the same upi:// parser as a real scan.
                </Text>
              </View>
            ) : (
              <View>
                <Card>
                  <Text style={[{ color: C.text, fontWeight: "700", marginBottom: 6 }]}>📷 Camera — only while you scan</Text>
                  <Text style={[{ color: C.muted, fontSize: 13, lineHeight: 19 }]}>
                    Borderless Pay uses the camera solely to read the payment QR in front of you. No photos or video are
                    captured, stored, or uploaded — the QR is decoded on your device.
                    {webCameraCapable()
                      ? " Your browser will ask for camera access in-context, like the app does on a phone."
                      : " No camera is available in this browser session, so the scan is simulated."}
                  </Text>
                </Card>
                <PrimaryButton title="Allow camera & scan" onPress={startWebScan} />
                <PrimaryButton title="Enter UPI ID instead" secondary onPress={() => startDom("upiid")} />
                <PrimaryButton title="Use demo QR (no camera)" secondary onPress={useDemoQr} />
              </View>
            )}
          </View>
        ) : (
          <View>
            <Text style={s.h2}>Scan any UPI QR</Text>
            {Platform.OS === "web" ? (
              // On web (incl. the browser demo) native camera QR scanning isn't
              // reliable, so we go straight to the manual / demo-QR path — no
              // camera mount, no external decoder dependency.
              <View>
                <Card>
                  <Text style={[{ color: C.text, fontWeight: "700", marginBottom: 6 }]}>📷 Camera scanning is a mobile feature</Text>
                  <Text style={[{ color: C.muted, fontSize: 13, lineHeight: 19 }]}>
                    Live QR scanning runs on the Android / iOS app. In the browser preview, enter a UPI ID or use the demo QR — every other feature works exactly the same.
                  </Text>
                </Card>
                <PrimaryButton title="Enter UPI ID instead" onPress={() => startDom("upiid")} />
                <PrimaryButton title="Use demo QR" secondary onPress={useDemoQr} />
              </View>
            ) : camPerm && camPerm.granted ? (
              <View>
                <View style={s.scanner}>
                  <CameraView
                    style={[{ flex: 1, alignSelf: "stretch" }]}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={onQrScanned}
                  />
                  <View style={s.scanline} pointerEvents="none" />
                </View>
                <Text style={[s.apiNote, { marginTop: 10 }]}>
                  Point at any UPI QR — payee and amount fill in automatically. Nothing is photographed or stored.
                </Text>
                <PrimaryButton title="Enter UPI ID instead" secondary onPress={() => startDom("upiid")} />
                <PrimaryButton title="Use demo QR (no camera)" secondary onPress={useDemoQr} />
              </View>
            ) : camPerm && !camPerm.canAskAgain ? (
              <View>
                <Card>
                  <Text style={[{ color: C.text, fontWeight: "700", marginBottom: 6 }]}>Camera access is turned off</Text>
                  <Text style={[{ color: C.muted, fontSize: 13, lineHeight: 19 }]}>
                    You previously denied camera access, so scanning is unavailable. You can enable it in your device
                    Settings, or continue without the camera — everything still works.
                  </Text>
                </Card>
                <PrimaryButton title="Open device settings" onPress={() => Linking.openSettings()} />
                <PrimaryButton title="Enter UPI ID instead" secondary onPress={() => startDom("upiid")} />
                <PrimaryButton title="Use demo QR (no camera)" secondary onPress={useDemoQr} />
              </View>
            ) : (
              <View>
                <Card>
                  <Text style={[{ color: C.text, fontWeight: "700", marginBottom: 6 }]}>📷 Camera — only while you scan</Text>
                  <Text style={[{ color: C.muted, fontSize: 13, lineHeight: 19 }]}>
                    Borderless Pay uses the camera solely to read the payment QR in front of you. No photos or video are
                    captured, stored, or uploaded — the QR is decoded on your device. Deny it and you can still pay by
                    entering a UPI ID.
                  </Text>
                </Card>
                <PrimaryButton title="Allow camera & scan" onPress={requestCamPerm} />
                <PrimaryButton title="Enter UPI ID instead" secondary onPress={() => startDom("upiid")} />
                <PrimaryButton title="Use demo QR (no camera)" secondary onPress={useDemoQr} />
              </View>
            )}
          </View>
        ))}

        {screen === "compose" && domIntent && (
          <View>
            <Text style={s.h2}>{domIntent.title}</Text>
            {domIntent.sub ? <Text style={s.sub}>{domIntent.sub}</Text> : null}

            {(domIntent.kind === "phone" || domIntent.kind === "request") && (
              <View>
                <Text style={s.label}>{domIntent.kind === "request" ? "Request from (name or phone)" : "Phone number"}</Text>
                <TextInput style={s.input} placeholder="+91 98765 43210" placeholderTextColor={C.muted} keyboardType={domIntent.kind === "request" ? "default" : "phone-pad"} value={form.phone} onChangeText={(v) => setF("phone", v)} />
              </View>
            )}

            {domIntent.kind === "upiid" && (
              <View>
                <Text style={s.label}>UPI ID</Text>
                <TextInput style={s.input} placeholder="name@bank" placeholderTextColor={C.muted} autoCapitalize="none" value={form.vpa} onChangeText={(v) => setF("vpa", v)} />
              </View>
            )}

            {domIntent.kind === "bank" && (
              <View>
                <Text style={s.label}>Account holder name</Text>
                <TextInput style={s.input} placeholder="e.g. Meera Joshi" placeholderTextColor={C.muted} value={form.payeeName} onChangeText={(v) => setF("payeeName", v)} />
                <Text style={s.label}>Account number</Text>
                <TextInput style={s.input} placeholder="00112233445566" placeholderTextColor={C.muted} keyboardType="number-pad" value={form.account} onChangeText={(v) => setF("account", v)} />
                <Text style={s.label}>IFSC code</Text>
                <TextInput style={s.input} placeholder="HDFC0001234" placeholderTextColor={C.muted} autoCapitalize="characters" value={form.ifsc} onChangeText={(v) => setF("ifsc", v)} />
              </View>
            )}

            {domIntent.kind === "recharge" && (
              <View>
                <Text style={s.label}>Operator</Text>
                <Chips value={form.operator} onChange={(v) => setF("operator", v)} options={OPERATORS.map((o) => ({ value: o, label: o }))} />
                <Text style={s.label}>Mobile number</Text>
                <TextInput style={s.input} placeholder="+91 98765 43210" placeholderTextColor={C.muted} keyboardType="phone-pad" value={form.phone} onChangeText={(v) => setF("phone", v)} />
              </View>
            )}

            {domIntent.kind === "bill" && (
              <View>
                <Text style={s.label}>Category</Text>
                <Chips value={form.billCategory} onChange={(v) => { setF("billCategory", v); setF("biller", ""); }} options={BILL_CATEGORIES.map((o) => ({ value: o, label: o }))} />
                <Text style={s.label}>Biller</Text>
                <Chips value={form.biller} onChange={(v) => setF("biller", v)} options={(BILLERS[form.billCategory] || []).map((o) => ({ value: o, label: o }))} />
                <Text style={s.label}>Consumer / account number</Text>
                <TextInput style={s.input} placeholder="Consumer ID" placeholderTextColor={C.muted} value={form.consumerId} onChangeText={(v) => setF("consumerId", v)} />
              </View>
            )}

            <Text style={s.label}>Amount (₹)</Text>
            <TextInput style={s.input} placeholder="0" placeholderTextColor={C.muted} keyboardType="decimal-pad" value={form.amount} onChangeText={(v) => setF("amount", v)} />

            {(domIntent.kind === "phone" || domIntent.kind === "upiid" || domIntent.kind === "contact" || domIntent.kind === "bank" || domIntent.kind === "merchant") && (
              <View>
                <Text style={s.label}>Note (optional)</Text>
                <TextInput style={s.input} placeholder="What's it for?" placeholderTextColor={C.muted} value={form.note} onChangeText={(v) => setF("note", v)} />
              </View>
            )}

            <Card>
              <Row label={domIntent.kind === "request" ? "You request" : "You pay"} value={fmtINR(Number(form.amount) || 0)} accent big />
              <Row label="Fee" value="₹0 • Free" accent />
              {domIntent.kind === "request" ? (
                <Row label="Status" value="Pending until paid" />
              ) : (
                <Row label="Speed" value="Instant" />
              )}
            </Card>

            {domIntent.kind === "request" ? (
              <PrimaryButton title="Send request" onPress={submitRequest} loading={busy} />
            ) : account && Number(form.amount) > account.balance ? (
              <Text style={s.shortfall}>Insufficient balance. You have {fmtINR(account.balance)}.</Text>
            ) : (
              <PrimaryButton title={"Proceed to pay " + fmtINR(Number(form.amount) || 0)} onPress={proceedDomestic} />
            )}
          </View>
        )}

        {screen === "auth" && (
          <View>
            <Text style={[s.h2, { textAlign: "center" }]}>🔒 Authorize</Text>
            {bioState === "checking" && (
              <View>
                <Text style={[s.sub, { textAlign: "center" }]}>Confirm it's you with Face ID / fingerprint…</Text>
                <Text style={[{ fontSize: 64, textAlign: "center", marginVertical: 10 }]}>👤</Text>
                <ActivityIndicator color={C.accent} />
              </View>
            )}
            {bioState === "failed" && (
              <View>
                <Text style={[s.sub, { textAlign: "center" }]}>Biometric authentication failed or was cancelled. Payments stay locked until you verify.</Text>
                <Text style={[{ fontSize: 64, textAlign: "center", marginVertical: 10 }]}>🚫</Text>
                <PrimaryButton title="Try biometrics again" onPress={runBiometric} />
                <PrimaryButton title="Cancel payment" secondary onPress={() => setScreen(authExitScreen())} />
              </View>
            )}
            {bioState === "passed" && (
              <View>
                <Text style={[s.sub, { textAlign: "center" }]}>Now enter your 4-digit payment PIN</Text>
                <Text style={[{ fontSize: 64, textAlign: "center", marginVertical: 10 }]}>✅</Text>
                <PinDots filled={pin.length} />
                <PinPad onKey={onPinKey} />
              </View>
            )}
          </View>
        )}

        {screen === "settle" && (
          <View>
            <Text style={[s.h2, { textAlign: "center" }]}>Settling securely…</Text>
            <View style={[{ marginTop: 20 }]}>
              {settleSteps.map((t, i) => (
                <View key={i} style={s.stepRow}>
                  <View style={[s.stepDot, i < step && s.stepDotDone]}>
                    <Text style={[{ color: i < step ? "#04122b" : C.muted, fontWeight: "700", fontSize: 12 }]}>
                      {i < step ? "✓" : i + 1}
                    </Text>
                  </View>
                  <Text style={[s.stepTxt, i < step && { color: C.text }]}>{t}</Text>
                </View>
              ))}
            </View>
            <ActivityIndicator color={C.accent} style={[{ marginTop: 20 }]} />
          </View>
        )}

        {screen === "receipt" && receipt && (
          <View>
            <Animated.View style={[s.check, { transform: [{ scale: checkScale }] }]}>
              <Text style={[{ color: "#04122b", fontSize: 44, fontWeight: "800" }]}>✓</Text>
            </Animated.View>
            <Text style={[s.h2, { textAlign: "center" }]}>
              {(receipt.kind === "p2p" ? "Sent " : "Paid ") + fmtINR(receipt.total)}
            </Text>
            <Text style={[s.sub, { textAlign: "center" }]}>{receiptPayeeName(receipt)}</Text>
            <Card>
              {receipt.kind === "p2p" && (
                <Row label="They received" value={symFor(receipt.currency) + " " + receipt.recipientAmount.toLocaleString()} accent />
              )}
              {!receipt.domestic && (
                <Row label="Rate" value={"1 " + receipt.currency + " = ₹" + receipt.rate} />
              )}
              {receipt.domestic && receipt.payee && receipt.payee.category ? (
                <Row label="Category" value={receipt.payee.category} />
              ) : null}
              <Row label="Fee" value={receipt.domestic ? "₹0 • Free" : fmtINR(receipt.fee)} accent={receipt.domestic} />
              <Row label="Reference" value={receipt.reference} />
            </Card>
            <Card>
              <Text style={s.hashLbl}>Settlement ledger hash</Text>
              <Text style={s.hash}>{receipt.settlement.hash}</Text>
              <Text style={s.hashLbl}>Public anchor (tx)</Text>
              <Text style={s.hash}>{receipt.anchor ? receipt.anchor.publicTxHash : "(batched next)"}</Text>
              <Text style={s.hashLbl}>Authorization signature</Text>
              <Text style={s.hash}>{receipt.signature.slice(0, 40) + "…"}</Text>
              {verifyResult && (
                <Text
                  style={[{
                    marginTop: 10, fontSize: 13, lineHeight: 19, fontWeight: "600",
                    color: verifyResult.pending ? C.muted : verifyResult.ok ? C.accent : "#ff6b6b",
                  }]}
                >
                  {verifyResult.pending ? "Verifying…" : (verifyResult.ok ? "✓ " : "✗ ") + verifyResult.message}
                </Text>
              )}
            </Card>
            <PrimaryButton title="🔎 Verify this receipt independently" secondary onPress={verifyReceipt} />
            <Text style={s.apiNote}>Recomputes the Merkle proof with on-device SHA-256 — no trust in the app required</Text>
            <PrimaryButton title="Done" onPress={() => { setVerifyResult(null); setScreen("home"); }} />
          </View>
        )}

        {screen === "history" && (
          <View>
            <Text style={s.h2}>Activity</Text>
            <HistoryList history={history} />
          </View>
        )}

        {screen === "contacts" && (
          <View>
            <Text style={s.h2}>Pay a contact</Text>
            <Text style={s.sub}>Matched on your device — nothing is uploaded. Pick who to pay.</Text>
            {phoneContacts.map((c, i) => (
              <TouchableOpacity key={c.id || i} style={s.txn} activeOpacity={0.8} onPress={() => payPhoneContact(c)}>
                <View style={[{ flexDirection: "row", alignItems: "center" }]}>
                  <Avatar initials={initials(c.name)} size={40} />
                  <View style={[{ marginLeft: 10 }]}>
                    <Text style={[{ color: C.text, fontWeight: "600" }]}>{c.name}</Text>
                    <Text style={[{ color: C.muted, fontSize: 12 }]}>{c.phoneNumbers[0].number}</Text>
                  </View>
                </View>
                <Text style={[{ color: C.accent, fontSize: 20 }]}>›</Text>
              </TouchableOpacity>
            ))}
            <PrimaryButton title="← Back" secondary onPress={() => setScreen("home")} />
          </View>
        )}
      </ScrollView>

      {showTabs && (
        <View style={s.tabbar}>
          <View style={s.tabbarInner}>
          <Tab label="Home" icon="🏠" active={screen === "home"} onPress={() => setScreen("home")} />
          <Tab label="Scan" icon="📷" active={screen === "scanDom" || screen === "scan"} onPress={startScanDomestic} />
          <Tab
            label="Activity"
            icon="📜"
            active={screen === "history"}
            onPress={async () => {
              await refresh();
              setScreen("history");
            }}
          />
          </View>
        </View>
      )}

      <AlertHost />
    </SafeAreaView>
  );
}

function ActionTile({ icon, label, onPress, tint }) {
  return (
    <TouchableOpacity style={s.tile} activeOpacity={0.8} onPress={onPress}>
      <View style={[s.tileIcon, tint && { backgroundColor: tint }]}>
        <Text style={[{ fontSize: 23 }]}>{icon}</Text>
      </View>
      <Text style={s.tileLbl} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function Tab({ label, icon, active, onPress }) {
  return (
    <TouchableOpacity style={s.tab} onPress={onPress} activeOpacity={0.7}>
      <View style={[s.tabInner, active && s.tabInnerActive]}>
        <Text style={[{ fontSize: 20 }]}>{icon}</Text>
      </View>
      <Text style={[s.tabTxt, active && { color: C.accent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function HistoryList({ history }) {
  if (!history || history.length === 0)
    return <Text style={[{ color: C.muted, marginTop: 10 }]}>No payments yet.</Text>;
  return (
    <View>
      {history.map((p) => (
        <View key={p.paymentId} style={s.txn}>
          <View style={[{ flexDirection: "row", alignItems: "center" }]}>
            <View style={s.txnIc}>
              <Text style={[{ fontSize: 18 }]}>{txnIcon(p)}</Text>
            </View>
            <View>
              <Text style={[{ color: C.text, fontWeight: "600" }]}>{txnName(p)}</Text>
              <Text style={[{ color: C.muted, fontSize: 12 }]}>{p.currency + " • " + p.reference}</Text>
            </View>
          </View>
          <View style={[{ alignItems: "flex-end" }]}>
            <Text style={[{ color: C.text, fontWeight: "700" }]}>{fmtINR(p.total)}</Text>
            <Text style={[{ color: C.accent, fontSize: 11 }]}>{p.kind === "p2p" ? "sent" : p.domestic ? "paid" : "settled"}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: rs(22), paddingBottom: rs(110), ...CONTENT },
  h1: { color: C.text, fontSize: rs(27), fontWeight: "800", marginBottom: 8, letterSpacing: -0.6 },
  h2: { color: C.text, fontSize: rs(21), fontWeight: "800", marginBottom: 12, letterSpacing: -0.3 },
  sub: { color: C.muted, fontSize: rs(14), lineHeight: rs(21), marginBottom: 20 },
  label: { color: C.muted, fontSize: 13, marginBottom: 6, fontWeight: "500" },
  input: { backgroundColor: C.card2, borderColor: "#2b3a6b", borderWidth: 1, borderRadius: 13, padding: rs(14), color: C.text, fontSize: rs(15), marginBottom: 12 },
  muted: { color: C.muted, fontSize: 13 },
  apiNote: { color: C.muted2, fontSize: 11, textAlign: "center", marginTop: 14 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  greet: { color: C.muted, fontSize: 13 },
  greetName: { color: C.text, fontSize: rs(22), fontWeight: "800", letterSpacing: -0.3 },
  balance: { color: C.text, fontSize: rs(36), fontWeight: "800", marginVertical: 6, letterSpacing: -1 },
  balanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  verifyChip: { backgroundColor: "#16233f", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  verifyChipTxt: { color: C.accent2, fontSize: 12, fontWeight: "700" },
  savings: { color: C.accent, fontSize: 12, textAlign: "center", marginVertical: 6 },
  shortfall: { color: "#ff8b8b", fontSize: 13, textAlign: "center", fontWeight: "600", backgroundColor: "rgba(255,107,107,0.1)", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginVertical: 8, lineHeight: 19 },
  scanner: { height: rs(230), borderRadius: 20, backgroundColor: "#0e1730", borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scanline: { position: "absolute", left: 16, right: 16, top: "20%", height: 2, backgroundColor: C.accent, opacity: 0.7 },
  qr: { width: 124, height: 124, backgroundColor: "#fff", borderRadius: 12, flexDirection: "row", flexWrap: "wrap", padding: 8 },
  qrCell: { width: "20%", height: "20%", backgroundColor: "#fff" },
  stepRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "#33406b", alignItems: "center", justifyContent: "center", marginRight: 12 },
  stepDotDone: { backgroundColor: C.accent, borderColor: C.accent },
  stepTxt: { color: C.muted, fontSize: 15, flex: 1 },
  check: { width: rs(84), height: rs(84), borderRadius: rs(42), backgroundColor: C.accent, alignItems: "center", justifyContent: "center", alignSelf: "center", marginVertical: 16, shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  hashLbl: { color: C.muted, fontSize: 12, marginTop: 8 },
  hash: { color: C.muted, fontSize: 11, fontFamily: "monospace", backgroundColor: "#0c1430", padding: 9, borderRadius: 9, marginTop: 4 },
  txn: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1b2546" },
  txnIc: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card2, alignItems: "center", justifyContent: "center", marginRight: 10 },
  tabbar: { position: "absolute", bottom: 0, left: 0, right: 0, height: rs(78), backgroundColor: "#0a1024", borderTopWidth: 1, borderTopColor: "#1b2546", paddingBottom: 10 },
  tabbarInner: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-around", ...CONTENT },
  tab: { alignItems: "center" },
  tabInner: { width: 44, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tabInnerActive: { backgroundColor: "#16233f" },
  tabTxt: { color: C.muted, fontSize: 11, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "22%", alignItems: "center", marginBottom: 8 },
  tileIcon: { width: rs(56), height: rs(56), borderRadius: rs(18), backgroundColor: C.card2, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  tileLbl: { color: C.muted, fontSize: 11, textAlign: "center" },
  person: { alignItems: "center", marginRight: 16, width: 60 },
  personName: { color: C.muted, fontSize: 12, marginTop: 6 },
  personAdd: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.accent, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  consentRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 6, marginBottom: 4 },
  consentBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#33406b", alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 1 },
  consentBoxOn: { backgroundColor: C.accent, borderColor: C.accent },
  consentTxt: { color: C.muted, fontSize: 13, lineHeight: 19, flex: 1 },
  consentLink: { color: C.accent, fontSize: 12, fontWeight: "600" },
  buildStamp: { color: C.muted2, fontSize: 10, textAlign: "center", marginTop: 6 },
});
