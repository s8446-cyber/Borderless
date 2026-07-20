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
  BackHandler,
  AppState,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import { CameraView, useCameraPermissions, WebQrScanner, webCameraCapable } from "./src/scanner";
import * as Contacts from "expo-contacts";
import * as Notifications from "expo-notifications";
import { appAlert, AlertHost, simulateBiometric, getSimPerm, requestSimPerm } from "./src/alert";
import { C, TINTS, CORRIDORS, P2P_CURRENCIES, OPERATORS, BILL_CATEGORIES, BILLERS } from "./src/theme";
import { fmtINR } from "./src/format";
import { api, setSession, hasSession, onSessionExpired } from "./src/api";
import { CONFIG } from "./src/config";
import { getDeviceId } from "./src/device";
import { foldMerkleProof } from "./src/sha256";
import { parseUpiQr } from "./src/upi";
import { rs, CONTENT } from "./src/responsive";
import { persistSession, loadPersistedSession, markOnboarded, clearPersistedSession } from "./src/session";
import { pinIssue } from "./src/pin";

// Version stamp (from package.json, inlined by Metro). Shown on the welcome
// screen so it's always obvious WHICH build is installed — if the number on
// screen doesn't match the repo, you're running a stale build (see README:
// "Seeing an old version?").
const APP_VERSION = require("./package.json").version;
import { Brand, Card, Row, Pill, Badges, PrimaryButton, Chips, PinDots, PinPad, SectionHeader, ScreenHeader, Avatar } from "./src/ui";

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

const TOPUP_STEPS = [
  "Authorize with PIN",
  "Credit Borderless balance",
  "Write to settlement ledger (hash-chained)",
  "Sign receipt (HMAC)",
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
  if (p.kind === "topup") return "➕";
  if (p.kind === "p2p") return "💸";
  if (p.kind === "payment") return "🧳";
  if (p.kind === "bill") return "🧾";
  if (p.kind === "recharge") return "📲";
  if (p.kind === "request") return "🔁";
  return "✅";
}

function txnName(p) {
  if (p.kind === "topup") return "Added to balance";
  if (p.domestic) return p.payee ? p.payee.name : "Payment";
  if (p.kind === "p2p") return p.recipient ? p.recipient.name : "Transfer";
  return p.merchant ? p.merchant.name : "Merchant";
}

function receiptPayeeName(r) {
  if (r.kind === "topup") return "to your Borderless balance";
  if (r.domestic) return "to " + (r.payee ? r.payee.name : "payee");
  if (r.kind === "p2p") return "to " + (r.recipient ? r.recipient.name : "recipient");
  return "to " + (r.merchant ? r.merchant.name : "merchant");
}

export default function App() {
  // "boot" while the persisted session is restored — the app
  // decides between welcome (first run), link (resume onboarding) and lock
  // (returning user) BEFORE drawing anything, like a professional app.
  const [screen, setScreen] = useState("boot");
  const [name, setName] = useState("");
  const [meta, setMeta] = useState(null); // /api/meta — settlement-mode disclosure
  const [bank, setBank] = useState("HDFC Bank");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinStage, setPinStage] = useState("create"); // create → confirm
  const [pin, setPin] = useState("");
  const [corridor, setCorridor] = useState("AED");
  const [intlMerchant, setIntlMerchant] = useState("");
  const [intlAmount, setIntlAmount] = useState("");
  const [account, setAccount] = useState(null);
  const [quote, setQuote] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [history, setHistory] = useState([]);
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

  // App lock (returning users): "device" = biometric / device credential,
  // "failed" = must retry.
  const [lockState, setLockState] = useState("device");
  const lockBusy = useRef(false);

  // Account credentials — sign-up (new users) and sign-in (returning users).
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginTotp, setLoginTotp] = useState("");
  const [totpNeeded, setTotpNeeded] = useState(false);

  const [quoteExpired, setQuoteExpired] = useState(false);
  const bgSince = useRef(0);

  const checkScale = useRef(new Animated.Value(0)).current;

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const c = CORRIDORS[corridor];
  const settleSteps = flow === "send" ? SEND_STEPS : flow === "domestic" ? (domIntent && domIntent.kind === "topup" ? TOPUP_STEPS : DOMESTIC_STEPS) : SETTLE_STEPS;
  const incomingRequest = requests.find((r) => r.direction === "incoming" && r.status === "pending");

  // ---- boot: restore the previous session, land on the right screen ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await loadPersistedSession();
        if (s) {
          setSession(s);
          if (!alive) return;
          setName(s.name || "");
          if (s.onboarded === "home") {
            setLockState("device");
            setScreen("lock");
            return;
          }
          setScreen("link");
          return;
        }
      } catch {
        /* any restore problem → clean first run */
      }
      if (alive) setScreen("welcome");
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---- honest deployment metadata (sandbox badge) — fetched once ----
  useEffect(() => {
    let alive = true;
    api("/api/meta")
      .then((m) => { if (alive) setMeta(m); })
      .catch(() => { /* backend unreachable — badge simply not shown yet */ });
    return () => { alive = false; };
  }, []);

  // ---- session expiry (live mode): return to a clean welcome, once ----
  useEffect(() => {
    onSessionExpired(() => {
      resetLocal();
      appAlert("Session expired", "For your security you've been signed out. Please verify again to continue.");
    });
  });

  // ---- auto-lock: backgrounded for over a minute → require unlock ----
  useEffect(() => {
    if (IS_WEB) return; // browsers have no trustworthy background signal for this
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        bgSince.current = Date.now();
        return;
      }
      if (next === "active" && bgSince.current) {
        const away = Date.now() - bgSince.current;
        bgSince.current = 0;
        const sessionScreens = ["home", "scan", "scanDom", "send", "compose", "history", "quote", "receipt", "contacts", "auth"];
        if (away > 60_000 && sessionScreens.includes(screen)) {
          setLockState("device");
          setScreen("lock");
        }
      }
    });
    return () => sub.remove();
  }, [screen]);

  // ---- Android hardware back: navigate, never accidentally exit ----
  function backTarget() {
    switch (screen) {
      case "signin": return "welcome";
      case "scan": case "send": case "scanDom": case "compose": case "contacts": case "history": return "home";
      case "quote": return flow === "send" ? "send" : "scan";
      case "auth": return authExitScreen();
      case "receipt": return "home";
      case "settle": case "lock": case "boot": return null; // block — nothing sane to go back to
      default: return undefined; // welcome / link / home → default OS behavior (exit)
    }
  }

  useEffect(() => {
    const onBack = () => {
      const t = backTarget();
      if (t === null) return true; // swallow
      if (t === undefined) return false; // let the OS handle it
      if (screen === "scanDom") setWebScan("idle");
      if (screen === "receipt") setVerifyResult(null);
      if (screen === "auth") setPin("");
      setScreen(t);
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [screen, flow, domIntent]);

  // ---- app unlock (returning users) ----
  // Auto-prompt once each time the lock screen appears — professional apps
  // don't make you hunt for the unlock button after every relaunch.
  const lockAutoPrompted = useRef(false);
  useEffect(() => {
    if (screen === "lock" && lockState === "device" && !lockAutoPrompted.current) {
      lockAutoPrompted.current = true;
      unlockWithDevice();
    }
    if (screen !== "lock") lockAutoPrompted.current = false;
  }, [screen, lockState]);

  async function unlockWithDevice() {
    if (lockBusy.current) return;
    lockBusy.current = true;
    try {
      if (IS_WEB) {
        const r = await simulateBiometric("Unlock Borderless Pay");
        if (!r.success) {
          setLockState("failed");
          return;
        }
        return finishUnlock();
      }
      const has = await LocalAuthentication.hasHardwareAsync().catch(() => false);
      const enrolled = has && (await LocalAuthentication.isEnrolledAsync().catch(() => false));
      if (!enrolled) {
        // No biometrics / device credential enrolled — the device has no lock
        // screen by the user's choice; the keystore-guarded session itself is
        // the credential, and every payment still requires the server-verified PIN.
        return finishUnlock();
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Borderless Pay",
        cancelLabel: "Cancel",
        disableDeviceFallback: false, // device PIN / pattern is an acceptable factor
      });
      if (result.success) return finishUnlock();
      setLockState("failed");
    } finally {
      lockBusy.current = false;
    }
  }

  async function finishUnlock() {
    setBusy(true);
    try {
      await refresh({ quiet: false });
      // refresh() may discover the stored session is dead (refresh token
      // expired or revoked) — the session-expiry handler has then already
      // routed to a clean welcome. Never override that with a signed-out
      // home screen.
      if (hasSession()) setScreen("home");
    } finally {
      setBusy(false);
    }
  }

  // Lock screen escape hatch: not you / can't unlock → sign out completely.
  function lockLogout() {
    appAlert("Sign out?", "You'll need to verify again to get back in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout },
    ]);
  }

  // ---- email sign-in (live-backend mode) ----
  async function handleLogin() {
    const email = loginEmail.trim().toLowerCase();
    if (!email || !loginPassword) {
      return appAlert("Missing details", "Enter your email and password to sign in.");
    }
    setBusy(true);
    try {
      const body = { email, password: loginPassword, deviceId: await getDeviceId() };
      if (loginTotp.trim()) body.totp = loginTotp.trim();
      const r = await api("/api/auth/login", { method: "POST", body });
      setSession(r);
      setLoginPassword("");
      setLoginTotp("");
      setTotpNeeded(false);
      // Restore the profile like a professional app: the real name and the
      // onboarding state come from the server (GET /api/me) — never guessed
      // from the email, and never inferred from a failed request (a network
      // blip must not shunt a fully-onboarded user into re-linking a bank).
      const me = await api("/api/me");
      const displayName = me.name || email.split("@")[0];
      setName(displayName);
      await persistSession({ token: r.token, refreshToken: r.refreshToken, name: displayName, onboarded: me.bankLinked ? "home" : "link" });
      if (me.bankLinked) {
        await refresh();
        setScreen("home");
      } else {
        setNewPin("");
        setConfirmPin("");
        setPinStage("create");
        setScreen("link");
      }
    } catch (e) {
      if (/two-factor|totp/i.test(e.message || "")) {
        setTotpNeeded(true);
        appAlert("Two-factor code needed", "Enter the 6-digit code from your authenticator app.");
      } else {
        appAlert("Sign-in failed", e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup() {
    const email = loginEmail.trim().toLowerCase();
    if (!name.trim()) {
      return appAlert("Enter your name", "We verify against a name — please enter yours to continue.");
    }
    if (!email || !loginPassword) {
      return appAlert("Missing details", "Enter your email and choose a password (8+ characters).");
    }
    if (!consent) {
      return appAlert("Consent needed", "Please read and accept the Terms of Service and Privacy Policy to continue.");
    }
    setBusy(true);
    try {
      const r = await api("/api/auth/signup", {
        method: "POST",
        body: {
          fullName: name.trim(), email, password: loginPassword, country: "IN",
          deviceId: await getDeviceId(),
          consent: { tosVersion: "1.0", privacyVersion: "1.0" },
        },
      });
      setSession(r);
      setLoginPassword("");
      // persist NOW so a kill between sign-up and bank-link resumes at link
      await persistSession({ token: r.token, refreshToken: r.refreshToken, name: name.trim(), onboarded: "link" });
      setNewPin("");
      setConfirmPin("");
      setPinStage("create");
      setScreen("link");
    } catch (e) {
      appAlert("Could not create your account", e.message);
    } finally {
      setBusy(false);
    }
  }

  // PIN creation is two-step (enter, then confirm) with bank-grade quality
  // rules — a typo in a payment PIN otherwise locks the wallet 5 tries later.
  function onNewPinKey(k) {
    const setter = pinStage === "create" ? setNewPin : setConfirmPin;
    setter((p) => (k === "del" ? p.slice(0, -1) : p.length < 4 ? p + k : p));
  }

  useEffect(() => {
    if (screen !== "link") return;
    if (pinStage === "create" && newPin.length === 4) {
      const issue = pinIssue(newPin);
      if (issue) {
        setNewPin("");
        appAlert("Choose a stronger PIN", issue);
        return;
      }
      setPinStage("confirm");
    }
    if (pinStage === "confirm" && confirmPin.length === 4) {
      if (confirmPin !== newPin) {
        setNewPin("");
        setConfirmPin("");
        setPinStage("create");
        appAlert("PINs don't match", "The two PINs were different — let's start again.");
      }
    }
  }, [newPin, confirmPin, pinStage, screen]);

  async function handleLink() {
    if (newPin.length !== 4 || pinStage !== "confirm" || confirmPin !== newPin) {
      return appAlert("Set a PIN", "Choose and confirm a 4-digit payment PIN first.");
    }
    setBusy(true);
    try {
      await api("/api/accounts/link", {
        method: "POST",
        body: { bank, pin: newPin },
      });
      await markOnboarded("home");
      setNewPin("");
      setConfirmPin("");
      await refresh();
      setScreen("home");
    } catch (e) {
      appAlert("Could not link", e.message);
    } finally {
      setBusy(false);
    }
  }

  // Refresh account data. Never throws: a network blip must not strand a tap
  // (the data that did load still renders; the rest catches up next refresh).
  async function refresh({ quiet = true } = {}) {
    try {
      const a = await api("/api/accounts");
      setAccount(a);
      const h = await api("/api/payments");
      setHistory(h.payments || []);
    } catch (e) {
      if (!quiet) appAlert("Connection problem", "Couldn't refresh your account: " + e.message);
      return false;
    }
    try {
      const cts = await api("/api/contacts");
      setContacts(cts.contacts || []);
      const rq = await api("/api/requests");
      setRequests(rq.requests || []);
    } catch (e) {
      // contacts/requests optional
    }
    if (!meta) api("/api/meta").then((m) => setMeta((prev) => prev || m)).catch(() => {});
    return true;
  }

  function startScan() {
    setFlow("pay");
    setIntlMerchant("");
    setIntlAmount("");
    setScreen("scan");
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
      setQuoteExpired(false);
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

  // DEVELOPMENT ONLY: a well-formed UPI QR payload for camera-less test
  // environments (emulators, CI). It runs through the SAME hardened upi://
  // parser as a physical QR, and it is compiled out of release builds —
  // production users always scan a real QR or type a real UPI ID.
  const SAMPLE_UPI_QR = "upi://pay?pa=teststore@axis&pn=Test%20Store";

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
        "You declined camera access this session, so scanning is unavailable. You can still pay by entering a UPI ID. (Reload the page to be asked again.)"
      );
    }
    const ok = await requestSimPerm("camera", {
      icon: "📷",
      title: "“Borderless Pay” Would Like to Access the Camera",
      message: "Borderless Pay uses the camera only while you scan a payment QR code. Photos and video are never captured or stored.",
    });
    if (!ok) {
      return appAlert("Camera off", "No problem — enter a UPI ID instead.");
    }
    if (__DEV__) return simScan();
    appAlert("No camera here", "This environment has no camera — pay by entering the UPI ID instead.");
  }

  // DEV ONLY — simulated scan: brief scanning animation, then the sample UPI
  // QR payload is fed through the real onQrScanned → parseUpiQr pipeline.
  function simScan() {
    setWebScan("sim");
    setTimeout(() => {
      setWebScan("idle");
      onQrScanned({ data: SAMPLE_UPI_QR });
    }, 1700);
  }

  // The real web camera failed to start.
  function onWebCamError(e) {
    setWebScan("idle");
    const name = e && e.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      appAlert(
        "Camera access is turned off",
        "You denied the browser's camera permission, so live scanning is unavailable. Enable it in your browser's site settings, or pay by entering the UPI ID."
      );
    } else if (__DEV__) {
      appAlert("Camera unavailable", "No usable camera was found — continuing with the simulated scanner (dev builds only).", [
        { text: "OK", onPress: simScan },
      ]);
    } else {
      appAlert("Camera unavailable", "No usable camera was found — pay by entering the UPI ID instead.");
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

  // DEV ONLY — camera-less environments (emulators): feed the sample QR
  // through the real parse pipeline. Compiled out of release builds.
  function useSampleQr() {
    onQrScanned({ data: SAMPLE_UPI_QR });
  }

  function startDom(kind) {
    setForm(EMPTY_FORM);
    const map = {
      topup: { title: "Add money", sub: "Fund your Borderless balance — recorded on the ledger like every transaction" },
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
  // Allow/Deny dialog; deny → manual entry remains one tap away, so the
  // feature degrades gracefully and never nags.
  async function payFromPhoneContacts() {
    // Web sim: show the OS-style contacts prompt, then (on allow) load the
    // user's recent payees (real data from their own history) as the picker.
    // Asked once and remembered for the session, like the OS.
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

  // Web sim: build a picker list (expo-contacts shape) from the user's OWN
  // recent payees so the "pick a contact" screen works in a browser.
  async function loadPhoneContactsWeb() {
    try {
      const { contacts } = await api("/api/contacts");
      const mapped = (contacts || []).filter((ct) => ct.phone).map((ct, i) => ({ id: "payee-" + i, name: ct.name, phoneNumbers: [{ number: ct.phone }] }));
      if (!mapped.length) return appAlert("No recent payees yet", "Pay someone once and they'll appear here. Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]);
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
      appAlert("Request sent", "We'll notify you when it's paid. Track it anytime under Activity → Requests.");
      setScreen("home");
    } catch (e) {
      appAlert("Could not send request", e.message);
    } finally {
      setBusy(false);
    }
  }

  function proceedDomestic() {
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      return appAlert("Enter an amount", domIntent && domIntent.kind === "topup" ? "How much do you want to add?" : "How much do you want to pay?");
    }
    setFlow("domestic");
    openAuth();
  }

  function buildDomesticRequest() {
    const amount = Number(form.amount);
    const k = domIntent ? domIntent.kind : "upi";
    if (k === "topup") return { endpoint: "/api/topup", body: { amount } };
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
    const amt = Number(intlAmount);
    if (!(amt > 0)) return appAlert("Enter an amount", "How much does the merchant charge (in their currency)?");
    setBusy(true);
    try {
      const q = await api("/api/quotes", {
        method: "POST",
        body: { currency: corridor, localAmount: amt },
      });
      setQuote(q);
      setQuoteExpired(false);
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
    const steps = flow === "send" ? SEND_STEPS : flow === "domestic" ? (domIntent && domIntent.kind === "topup" ? TOPUP_STEPS : DOMESTIC_STEPS) : SETTLE_STEPS;
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
        body = { quoteId: quote.quoteId, pin: enteredPin, merchant: { name: intlMerchant.trim() || "Merchant", country: corridor } };
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
      // A mistyped PIN gets an in-place retry (the pad is right there and the
      // server's lockout counter still applies) — professional apps don't
      // bounce you back to the form to re-enter everything.
      if (/incorrect pin/i.test(e.message || "")) {
        appAlert("Incorrect PIN", e.message + ". Try again — 5 wrong attempts lock your wallet.");
        setScreen("auth");
        return;
      }
      appAlert("Could not complete", e.message);
      setScreen(authExitScreen());
    }
  }

  // Recompute the receipt's Merkle inclusion proof CLIENT-SIDE (pure-JS
  // SHA-256 — no trust in the server for the math).
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

  // Open the hosted policy document, with an inline key-points fallback if
  // the device can't open it (informed consent either way).
  async function openPolicy(doc, title, summary) {
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
    "Sandbox phase — money movement is simulated until licensed rails go live, and every receipt is stamped 'sandbox'. ₹0 domestic fee; cross-border at the mid-market rate + flat 0.5% (₹2 min, ₹500 cap), always shown before you confirm. Balances start at ₹0 and are funded only through the audited Add-money flow. Keep your PIN and 2FA codes secret. Full terms: terms.html on the web app.";

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
    await clearPersistedSession().catch(() => {});
    setAccount(null);
    setHistory([]);
    setRequests([]);
    setContacts([]);
    setReceipt(null);
    setQuote(null);
    setVerifyResult(null);
    setNewPin("");
    setConfirmPin("");
    setPinStage("create");
    setPin("");
    setName("");
    setLoginEmail("");
    setLoginPassword("");
    setLoginTotp("");
    setTotpNeeded(false);
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
        {screen === "boot" && (
          <View style={s.bootWrap}>
            <Brand subtitle="Pay at home & across borders" />
            <ActivityIndicator color={C.accent} size="large" style={[{ marginTop: 40 }]} />
          </View>
        )}

        {screen === "lock" && (
          <View>
            <Brand subtitle="Locked" />
            <View style={[{ alignItems: "center", marginTop: 18 }]}>
              <Avatar initials={initials(name)} size={72} />
              <Text style={[s.h2, { marginTop: 14, textAlign: "center" }]}>Welcome back{name ? ", " + name.split(" ")[0] : ""}</Text>
            </View>
            {lockState === "failed" ? (
              <View>
                <Text style={[s.sub, { textAlign: "center" }]}>Authentication failed or was cancelled. Your money stays locked until you verify.</Text>
                <PrimaryButton title="Try again" onPress={() => { setLockState("device"); unlockWithDevice(); }} loading={busy} />
              </View>
            ) : (
              <View>
                <Text style={[s.sub, { textAlign: "center" }]}>Unlock with Face ID / fingerprint / device PIN</Text>
                <PrimaryButton title="🔓 Unlock" onPress={unlockWithDevice} loading={busy} />
              </View>
            )}
            <TouchableOpacity onPress={lockLogout} activeOpacity={0.7} style={[{ marginTop: 18 }]}>
              <Text style={[{ color: C.muted, fontSize: 13, textAlign: "center", fontWeight: "600" }]}>Not you? Sign out</Text>
            </TouchableOpacity>
            <Text style={s.buildStamp}>v{APP_VERSION} · {CONFIG.API_BASE}{meta && meta.settlementMode === "sandbox" ? " · 🧪 sandbox rails" : ""}</Text>
            {!__DEV__ && CONFIG.USING_DEV_FALLBACK ? (
              <Text style={[s.buildStamp, { color: C.warn }]}>⚠️ Release build without EXPO_PUBLIC_API_BASE — pointing at the local-dev fallback. Set it to your deployed backend URL.</Text>
            ) : null}
          </View>
        )}

        {screen === "signin" && (
          <View>
            <ScreenHeader title="Sign in" onBack={() => setScreen("welcome")} />
            <Text style={s.sub}>Sign in with your Borderless Pay email and password — your account works across the app and the web. You stay signed in on this device until you log out.</Text>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={loginEmail}
              onChangeText={setLoginEmail}
            />
            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              placeholder="••••••••"
              placeholderTextColor={C.muted}
              secureTextEntry
              autoCapitalize="none"
              value={loginPassword}
              onChangeText={setLoginPassword}
            />
            {totpNeeded && (
              <View>
                <Text style={s.label}>Two-factor code</Text>
                <TextInput
                  style={s.input}
                  placeholder="123 456"
                  placeholderTextColor={C.muted}
                  keyboardType="number-pad"
                  value={loginTotp}
                  onChangeText={setLoginTotp}
                />
              </View>
            )}
            <PrimaryButton title="Sign in →" onPress={handleLogin} loading={busy} />
            <Text style={s.apiNote}>POST /api/auth/login • lockout-guarded, optional TOTP 2FA</Text>
          </View>
        )}

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
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={loginEmail}
              onChangeText={setLoginEmail}
            />
            <Text style={s.label}>Password (min 8 characters)</Text>
            <TextInput
              style={s.input}
              placeholder="••••••••"
              placeholderTextColor={C.muted}
              secureTextEntry
              autoCapitalize="none"
              value={loginPassword}
              onChangeText={setLoginPassword}
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
            <PrimaryButton title="Create your account →" onPress={handleSignup} loading={busy} />
            <TouchableOpacity onPress={() => setScreen("signin")} activeOpacity={0.7} style={[{ marginTop: 14 }]}>
              <Text style={[{ color: C.accent, fontSize: 14, textAlign: "center", fontWeight: "700" }]}>
                Already have an account? Sign in
              </Text>
            </TouchableOpacity>
            <Text style={s.apiNote}>POST /api/auth/signup • scrypt-hashed password • consent recorded & versioned</Text>
            {meta && meta.settlementMode === "sandbox" ? (
              <Text style={s.apiNote}>🧪 Sandbox settlement: money movement is simulated until licensed rails go live — every receipt says so.</Text>
            ) : null}
            <Text style={s.buildStamp}>v{APP_VERSION} · {CONFIG.API_BASE}{meta && meta.settlementMode === "sandbox" ? " · 🧪 sandbox rails" : ""}</Text>
            {!__DEV__ && CONFIG.USING_DEV_FALLBACK ? (
              <Text style={[s.buildStamp, { color: C.warn }]}>⚠️ Release build without EXPO_PUBLIC_API_BASE — pointing at the local-dev fallback. Set it to your deployed backend URL.</Text>
            ) : null}
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
            {pinStage === "create" ? (
              <View>
                <Text style={s.label}>Create a 4-digit payment PIN</Text>
                <PinDots filled={newPin.length} />
              </View>
            ) : (
              <View>
                <Text style={s.label}>Confirm your PIN — enter it once more</Text>
                <PinDots filled={confirmPin.length} />
                <TouchableOpacity
                  onPress={() => { setNewPin(""); setConfirmPin(""); setPinStage("create"); }}
                  activeOpacity={0.7}
                >
                  <Text style={[{ color: C.accent, fontSize: 12, textAlign: "center", fontWeight: "600", marginBottom: 4 }]}>Start PIN over</Text>
                </TouchableOpacity>
              </View>
            )}
            <PinPad onKey={onNewPinKey} />
            <PrimaryButton
              title="Link account"
              onPress={handleLink}
              loading={busy}
              disabled={pinStage !== "confirm" || confirmPin.length !== 4 || confirmPin !== newPin}
            />
            <Text style={s.apiNote}>POST /api/accounts/link • PIN stored as scrypt hash</Text>
            <TouchableOpacity
              onPress={() =>
                appAlert("Start over?", "This discards your verification and returns to the beginning.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Start over", style: "destructive", onPress: logout },
                ])
              }
              activeOpacity={0.7}
              style={[{ marginTop: 12 }]}
            >
              <Text style={[{ color: C.muted, fontSize: 13, textAlign: "center", fontWeight: "600" }]}>← Start over</Text>
            </TouchableOpacity>
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
                <View style={[{ flexDirection: "row", alignItems: "center" }]}>
                  {meta && meta.settlementMode === "sandbox" ? (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={[s.verifyChip, { marginRight: 8 }]}
                      onPress={() => appAlert("🧪 Sandbox rails", "Money movement is simulated end-to-end while our sponsor-bank and PSP integrations are finalized. Every receipt is cryptographically signed and stamped 'sandbox' — nothing here pretends to be real money.")}
                    >
                      <Text style={[s.verifyChipTxt, { color: C.warn }]}>🧪 Sandbox</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={verifyLedger} activeOpacity={0.7} style={s.verifyChip}>
                    <Text style={s.verifyChipTxt}>🔎 Verify</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Badges items={["🔐 scrypt PIN", "⛓️ dual ledger", "✍️ HMAC signed"]} />
            </Card>

            {account && account.balance === 0 && history.length === 0 && (
              <Card glow>
                <Text style={[{ color: C.text, fontWeight: "700", marginBottom: 4 }]}>👋 Welcome! Add money to get started</Text>
                <Text style={[{ color: C.muted, fontSize: 13, marginBottom: 10 }]}>
                  Your balance starts at ₹0 — every rupee is added explicitly and recorded on the tamper-evident ledger.
                </Text>
                <PrimaryButton title="➕ Add money" onPress={() => startDom("topup")} />
              </Card>
            )}

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
              <ActionTile icon="➕" label="Add money" tint={TINTS.mint} onPress={() => startDom("topup")} />
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

            <SectionHeader title="Recent" action={history.length ? "See all" : null} onAction={async () => { await refresh({ quiet: false }); if (hasSession()) setScreen("history"); }} />
            <HistoryList history={history} />
          </View>
        )}

        {screen === "scan" && (
          <View>
            <ScreenHeader title="Pay abroad" onBack={() => setScreen("home")} />
            <Text style={s.sub}>
              Choose the merchant's currency, enter who you're paying and the amount they charge —
              the transparent mid-market conversion is shown before you confirm.
            </Text>
            <Text style={s.label}>Currency corridor</Text>
            <Chips
              value={corridor}
              onChange={setCorridor}
              options={Object.keys(CORRIDORS).map((k) => ({ value: k, label: CORRIDORS[k].flag + " " + k }))}
            />
            <Text style={s.label}>Merchant name</Text>
            <TextInput
              style={s.input}
              placeholder={c.example}
              placeholderTextColor={C.muted}
              value={intlMerchant}
              onChangeText={setIntlMerchant}
            />
            <Text style={s.label}>Amount they charge ({c.sym})</Text>
            <TextInput
              style={s.input}
              placeholder="0"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              value={intlAmount}
              onChangeText={setIntlAmount}
            />
            <PrimaryButton title="Get quote →" onPress={getQuote} loading={busy} />
          </View>
        )}

        {screen === "send" && (
          <View>
            <ScreenHeader title="Send money abroad" onBack={() => setScreen("home")} />
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
            <ScreenHeader title="Confirm transfer" onBack={() => setScreen("send")} />
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
            <QuoteCountdown expiresAt={quote.expiresAt} expired={quoteExpired} onExpire={() => setQuoteExpired(true)} />
            {account && quote.total > account.balance ? (
              <View>
                <Text style={s.shortfall}>Insufficient balance. You have {fmtINR(account.balance)} — this transfer needs {fmtINR(quote.total)}.</Text>
                <PrimaryButton title="Change amount" secondary onPress={() => setScreen("send")} />
              </View>
            ) : quoteExpired ? (
              <PrimaryButton title="Rate expired — get a fresh quote" onPress={getTransferQuote} loading={busy} />
            ) : (
              <PrimaryButton title="Send securely 🔒" onPress={openAuth} />
            )}
          </View>
        )}

        {screen === "quote" && quote && quote.kind !== "p2p" && (
          <View>
            <ScreenHeader title="Confirm payment" onBack={() => setScreen("scan")} />
            <Text style={s.sub}>{(intlMerchant.trim() || "Merchant") + " · " + c.flag + " " + c.country}</Text>
            <Card glow>
              <Row label="They charge" value={c.sym + " " + Number(intlAmount).toLocaleString()} />
              <Row label="Exchange rate (mid-market)" value={"1 " + corridor + " = ₹" + quote.rate} accent />
              <Row label="Converted amount" value={fmtINR(quote.amount)} />
              <Row label="FX markup" value="₹0.00" accent />
              <Row label="Borderless fee (0.5%)" value={fmtINR(quote.fee)} />
              <Row label="Total from bank" value={fmtINR(quote.total)} accent big />
            </Card>
            <Text style={s.savings}>
              You save ~{fmtINR(quote.amount * 0.035 + 200 - quote.fee)} vs a typical bank card
            </Text>
            <QuoteCountdown expiresAt={quote.expiresAt} expired={quoteExpired} onExpire={() => setQuoteExpired(true)} />
            {account && quote.total > account.balance ? (
              <View>
                <Text style={s.shortfall}>Insufficient balance. You have {fmtINR(account.balance)} — this payment needs {fmtINR(quote.total)}.</Text>
                <PrimaryButton title="Back" secondary onPress={() => setScreen("scan")} />
              </View>
            ) : quoteExpired ? (
              <PrimaryButton title="Rate expired — get a fresh quote" onPress={getQuote} loading={busy} />
            ) : (
              <PrimaryButton title="Pay securely 🔒" onPress={openAuth} />
            )}
          </View>
        )}

        {screen === "scanDom" && (IS_WEB ? (
          <View>
            <ScreenHeader title="Scan any UPI QR" onBack={() => { setWebScan("idle"); setScreen("home"); }} />
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
                {__DEV__ ? <PrimaryButton title="Use sample QR (dev builds only)" secondary onPress={useSampleQr} /> : null}
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
                  Simulated camera (dev builds only — no camera available here). Detecting the sample UPI QR — it runs through the same upi:// parser as a real scan.
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
                {__DEV__ ? <PrimaryButton title="Use sample QR (dev builds only)" secondary onPress={useSampleQr} /> : null}
              </View>
            )}
          </View>
        ) : (
          <View>
            <ScreenHeader title="Scan any UPI QR" onBack={() => setScreen("home")} />
            {camPerm && camPerm.granted ? (
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
                {__DEV__ ? <PrimaryButton title="Use sample QR (dev builds only)" secondary onPress={useSampleQr} /> : null}
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
                {__DEV__ ? <PrimaryButton title="Use sample QR (dev builds only)" secondary onPress={useSampleQr} /> : null}
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
                {__DEV__ ? <PrimaryButton title="Use sample QR (dev builds only)" secondary onPress={useSampleQr} /> : null}
              </View>
            )}
          </View>
        ))}

        {screen === "compose" && domIntent && (
          <View>
            <ScreenHeader title={domIntent.title} onBack={() => setScreen("home")} />
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
              <Row
                label={domIntent.kind === "request" ? "You request" : domIntent.kind === "topup" ? "You add" : "You pay"}
                value={fmtINR(Number(form.amount) || 0)}
                accent
                big
              />
              <Row label="Fee" value="₹0 • Free" accent />
              {domIntent.kind === "request" ? (
                <Row label="Status" value="Pending until paid" />
              ) : domIntent.kind === "topup" ? (
                <Row label="Settlement" value={meta && meta.settlementMode === "sandbox" ? "🧪 Sandbox (simulated)" : "Live"} />
              ) : (
                <Row label="Speed" value="Instant" />
              )}
            </Card>

            {domIntent.kind === "request" ? (
              <PrimaryButton title="Send request" onPress={submitRequest} loading={busy} />
            ) : domIntent.kind === "topup" ? (
              <PrimaryButton title={"Add " + fmtINR(Number(form.amount) || 0) + " to balance"} onPress={proceedDomestic} />
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
                <TouchableOpacity onPress={() => { setPin(""); setScreen(authExitScreen()); }} activeOpacity={0.7} style={[{ marginTop: 12 }]}>
                  <Text style={[{ color: C.muted, fontSize: 13, textAlign: "center", fontWeight: "600" }]}>Cancel payment</Text>
                </TouchableOpacity>
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
              {(receipt.kind === "topup" ? "Added " : receipt.kind === "p2p" ? "Sent " : "Paid ") + fmtINR(receipt.total)}
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
              {receipt.settlementMode === "sandbox" ? (
                <Row label="Settlement" value="🧪 Sandbox (simulated rails)" />
              ) : null}
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
            {requests.length > 0 && (
              <View>
                <SectionHeader title="Requests" />
                {requests.map((r) => (
                  <View key={r.id} style={s.txn}>
                    <View style={[{ flexDirection: "row", alignItems: "center", flex: 1 }]}>
                      <View style={s.txnIc}>
                        <Text style={[{ fontSize: 18 }]}>{r.direction === "incoming" ? "📥" : "📤"}</Text>
                      </View>
                      <View style={[{ flex: 1, marginRight: 8 }]}>
                        <Text style={[{ color: C.text, fontWeight: "600" }]} numberOfLines={1}>
                          {r.direction === "incoming" ? r.fromName + " requested you" : "You requested " + r.fromName}
                        </Text>
                        <Text style={[{ color: C.muted, fontSize: 12 }]} numberOfLines={1}>
                          {(r.note ? r.note + " • " : "") + new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </Text>
                      </View>
                    </View>
                    <View style={[{ alignItems: "flex-end" }]}>
                      <Text style={[{ color: C.text, fontWeight: "700" }]}>{fmtINR(r.amount)}</Text>
                      {r.direction === "incoming" && r.status === "pending" ? (
                        <TouchableOpacity onPress={() => payIncomingRequest(r)} activeOpacity={0.7}>
                          <Text style={[{ color: C.accent, fontWeight: "800", fontSize: 12, marginTop: 3 }]}>Pay now →</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={[{ color: r.status === "paid" ? C.good : C.warn, fontSize: 11, fontWeight: "800", marginTop: 3 }]}>
                          {r.status === "paid" ? "✓ PAID" : "PENDING"}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
                <SectionHeader title="Payments" />
              </View>
            )}
            <HistoryList history={history} />
          </View>
        )}

        {screen === "contacts" && (
          <View>
            <ScreenHeader title="Pay a contact" onBack={() => setScreen("home")} />
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
              await refresh({ quiet: false });
              if (hasSession()) setScreen("history");
            }}
          />
          </View>
        </View>
      )}

      <AlertHost />
    </SafeAreaView>
  );
}

// Live countdown for the 60-second rate lock. Professional apps never let a
// quote silently die under the user's finger — the timer is visible, and at
// zero the pay button swaps to "get a fresh quote".
function QuoteCountdown({ expiresAt, expired, onExpire }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil(((expiresAt || 0) - Date.now()) / 1000)));
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const l = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) {
        clearInterval(id);
        if (onExpire) onExpire();
      }
    };
    const id = setInterval(tick, 500);
    tick();
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <Text style={[s.rateTimer, (expired || left <= 0) ? { color: C.warn } : left <= 10 ? { color: C.warn } : null]}>
      {expired || left <= 0 ? "⏳ Rate lock expired" : `🔒 Rate locked · ${mm}:${ss}`}
    </Text>
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
  bootWrap: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 420 },
  rateTimer: { color: C.accent2, fontSize: 12, textAlign: "center", fontWeight: "700", marginBottom: 4 },
});
