// Borderless Pay — React Native (Expo) app. Android + iOS + web.
//
// ARCHITECTURE (UI/UX refactor):
//  - App.js is now a thin shell: state + handlers + a route switch. All screen
//    JSX lives in src/screens/* and shared widgets in src/ui.js, so each piece
//    is small enough to review and unit-test (pure logic lives in src/*.js
//    with node --test coverage).
//  - Screens consume state through AppContext (src/screens/context.js).
//  - Theming: dark + light palettes follow the OS scheme (src/theme.js).
//  - Localization: all screen strings go through src/i18n.js (en + hi).
//  - Icons: vector Ionicons via src/icons.js — no emoji glyph lottery.
//  - Connectivity: src/net.js is fed by the API layer; an offline banner
//    renders app-wide and errors use human copy (src/errors.js).
//  - "Settling securely" progress is driven by the REAL request lifecycle:
//    steps advance only while the request is in flight and the final step
//    completes when the backend responds — never a free-running timer.
//  - Web builds get hash-based deep links (#/home, #/activity, …) via
//    src/routes.js; Android hardware back uses the same route table.
import React, { useState, useEffect, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  BackHandler,
  AppState,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as Contacts from "expo-contacts";
import * as Notifications from "expo-notifications";
import { CameraView, useCameraPermissions, WebQrScanner, webCameraCapable } from "./src/scanner";
import { appAlert, AlertHost, simulateBiometric, getSimPerm, requestSimPerm } from "./src/alert";
import { api, setSession, hasSession, onSessionExpired } from "./src/api";
import { getDeviceId } from "./src/device";
import { foldMerkleProof } from "./src/sha256";
import { parseUpiQr } from "./src/upi";
import { rs, CONTENT } from "./src/responsive";
import { persistSession, loadPersistedSession, markOnboarded, rememberProfile, clearPersistedSession } from "./src/session";
import { ThemeProvider, useTheme } from "./src/theme";
import { Card, PrimaryButton, ScreenHeader, OfflineBanner } from "./src/ui";
import { Icon } from "./src/icons";
import { routeToHash, backTargetFor as routeBackTarget } from "./src/routes";
import { subscribeOnline } from "./src/net";
import { t, setLocale, detectLocale, onLocaleChange, offLocaleChange } from "./src/i18n";
import { humanError } from "./src/errors";

import { AppContext, useApp } from "./src/screens/context";
import { BootScreen, WelcomeScreen, SigninScreen, SignupScreen, ResetScreen, LinkScreen, LockScreen } from "./src/screens/onboarding";
import { HomeScreen } from "./src/screens/home";
import { ScanScreen, SendScreen, ComposeScreen, QuoteScreen } from "./src/screens/pay";
import { ReviewScreen } from "./src/screens/review";
import { AuthScreen, SettleScreen } from "./src/screens/authsettle";
import { ReceiptScreen } from "./src/screens/receipt";
import { ActivityScreen, TxnDetailScreen } from "./src/screens/activity";
import { ContactsScreen } from "./src/screens/contacts";
import { HelpScreen } from "./src/screens/help";

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

const SAMPLE_UPI_QR = "upi://pay?pa=teststore@axis&pn=Test%20Store";

const BANK_BY_IFSC = {
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  SBIN: "State Bank of India",
  UTIB: "Axis Bank",
};

export default function App() {
  return (
    <ThemeProvider>
      <AppRoot />
    </ThemeProvider>
  );
}

function AppRoot() {
  const C = useTheme();

  // ---- navigation ----
  const [screen, setScreenRaw] = useState("boot");
  const screenRef = useRef("boot");
  function go(next) {
    screenRef.current = next;
    setScreenRaw(next);
    if (IS_WEB && typeof window !== "undefined") {
      const h = routeToHash(next);
      if (h && window.location.hash !== h) {
        try { window.location.hash = h; } catch { /* ignore */ }
      }
    }
  }

  // ---- profile / account ----
  const [name, setName] = useState("");
  const [meta, setMeta] = useState(null);
  const [account, setAccount] = useState(null);
  const [history, setHistory] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [phoneContacts, setPhoneContacts] = useState([]);

  // ---- payment flow ----
  const [flow, setFlow] = useState("pay");
  const [domIntent, setDomIntent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [intlMerchant, setIntlMerchant] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [payeeVerified, setPayeeVerified] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [helpFrom, setHelpFrom] = useState(null);

  // ---- auth (PIN) + settle ----
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [settleStepIndex, setSettleStepIndex] = useState(0);
  const [settleError, setSettleError] = useState(null);
  const settleTimer = useRef(null);
  const authInFlight = useRef(false);
  const lastSend = useRef({ currency: "AED", amount: 0 });

  // ---- lock / scanner / misc ----
  const [lockState, setLockState] = useState("device");
  const lockBusy = useRef(false);
  const lastKnownStage = useRef("home");
  const bgSince = useRef(0);
  const [webScan, setWebScan] = useState("idle");
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scanLock = useRef(false);
  const lastBadQr = useRef(0);

  // ---- connectivity + locale ----
  const [offline, setOffline] = useState(false);
  const [, setLocaleTick] = useState(0);

  const updateForm = (patch) => setForm((p) => ({ ...p, ...patch }));

  const settleSteps =
    flow === "send" ? SEND_STEPS
    : flow === "domestic" ? (domIntent && domIntent.kind === "topup" ? TOPUP_STEPS : DOMESTIC_STEPS)
    : SETTLE_STEPS;

  // ---- boot: locale, then restore the previous session ----
  useEffect(() => {
    try {
      const deviceLocale =
        (typeof navigator !== "undefined" && navigator.language) ||
        Intl.DateTimeFormat().resolvedOptions().locale ||
        "en";
      setLocale(detectLocale(deviceLocale));
    } catch { /* default locale stays "en" */ }
    let alive = true;
    (async () => {
      try {
        const s = await loadPersistedSession();
        if (s) {
          setSession(s);
          if (!alive) return;
          setName(s.name || "");
          lastKnownStage.current = s.onboarded === "home" ? "home" : "link";
          setLockState("device");
          go("lock");
          return;
        }
      } catch { /* any restore problem → clean first run */ }
      if (alive) go("welcome");
    })();
    return () => { alive = false; };
  }, []);

  // ---- re-render when the language changes ----
  useEffect(() => {
    const cb = () => setLocaleTick((x) => x + 1);
    onLocaleChange(cb);
    return () => offLocaleChange(cb);
  }, []);

  // ---- offline banner: fed by the API layer via src/net.js ----
  useEffect(() => {
    const unsub = subscribeOnline((on) => setOffline(!on));
    return typeof unsub === "function" ? unsub : undefined;
  }, []);

  // ---- honest deployment metadata (sandbox badge) — fetched once ----
  useEffect(() => {
    let alive = true;
    api("/api/meta")
      .then((m) => { if (alive) setMeta(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ---- session expiry: return to a clean welcome, once ----
  useEffect(() => {
    onSessionExpired(() => {
      resetLocal();
      appAlert("Session expired", "For your security you've been signed out. Please verify again to continue.");
    });
  });

  // ---- web deep links: #/home, #/activity, #/help, … ----
  useEffect(() => {
    if (!IS_WEB || typeof window === "undefined") return;
    const onHash = () => {
      const target = parseHashSafe(window.location.hash);
      if (target && target !== screenRef.current && hasSession()) {
        screenRef.current = target;
        setScreenRaw(target);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ---- auto-lock: backgrounded for over a minute → require unlock ----
  useEffect(() => {
    if (IS_WEB) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") { bgSince.current = Date.now(); return; }
      if (next === "active" && bgSince.current) {
        const away = Date.now() - bgSince.current;
        bgSince.current = 0;
        const sessionScreens = ["home", "scan", "scanDom", "send", "compose", "review", "history", "txnDetail", "quote", "receipt", "contacts", "help", "auth"];
        if (away > 60_000 && sessionScreens.includes(screen)) { setLockState("device"); go("lock"); }
      }
    });
    return () => sub.remove();
  }, [screen]);

  // ---- Android hardware back ----
  useEffect(() => {
    const onBack = () => {
      if (["settle", "lock", "boot"].includes(screen)) return true;
      if (["welcome", "home", "link"].includes(screen)) return false;
      const target = routeBackTarget(screen, { flow, domIntentKind: domIntent && domIntent.kind, helpFrom });
      if (!target || target === screen) return false;
      if (screen === "scanDom") setWebScan("idle");
      if (screen === "receipt") setVerifyResult(null);
      if (screen === "auth") setPin("");
      go(target);
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [screen, flow, domIntent, helpFrom]);

  // ---- quote expiry ----
  useEffect(() => {
    if (!quote || !quote.expiresAt) return;
    const ms = quote.expiresAt - Date.now();
    if (ms <= 0) { setQuoteExpired(true); return; }
    const id = setTimeout(() => setQuoteExpired(true), ms);
    return () => clearTimeout(id);
  }, [quote]);

  // ---- app unlock (returning users) ----
  const lockAutoPrompted = useRef(false);
  useEffect(() => {
    if (screen === "lock" && lockState === "device" && !lockAutoPrompted.current) {
      lockAutoPrompted.current = true;
      unlockWithDevice().catch(() => {});
    }
    if (screen !== "lock") lockAutoPrompted.current = false;
  }, [screen, lockState]);

  async function unlockWithDevice() {
    if (lockBusy.current) return;
    lockBusy.current = true;
    try {
      if (IS_WEB) {
        const r = await simulateBiometric("Unlock Borderless Pay");
        if (!r.success) { setLockState("failed"); throw new Error("Authentication was cancelled. Your money stays locked until you verify."); }
        return await finishUnlock();
      }
      const has = await LocalAuthentication.hasHardwareAsync().catch(() => false);
      const enrolled = has && (await LocalAuthentication.isEnrolledAsync().catch(() => false));
      if (!enrolled) return await finishUnlock();
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Borderless Pay", cancelLabel: "Cancel", disableDeviceFallback: false });
      if (result.success) return await finishUnlock();
      setLockState("failed");
      throw new Error("Authentication failed or was cancelled. Your money stays locked until you verify.");
    } finally { lockBusy.current = false; }
  }

  function routeToStage(stage) { go(stage === "home" ? "home" : "link"); }

  async function finishUnlock() {
    setLockState("device");
    routeToStage(lastKnownStage.current);
    try {
      const me = await api("/api/me");
      const displayName = me.name || name;
      setName(displayName);
      const stage = me.bankLinked ? "home" : "link";
      if (stage !== lastKnownStage.current) { lastKnownStage.current = stage; routeToStage(stage); }
      rememberProfile({ name: displayName, onboarded: stage }).catch(() => {});
      if (stage === "home") refresh();
    } catch (e) {
      if (!hasSession()) return;
      if (lastKnownStage.current === "home") refresh();
    }
  }

  async function handleLogin(email, password, totp) {
    const body = { email: email.toLowerCase(), password, deviceId: await getDeviceId() };
    if (totp) body.totp = totp;
    let r;
    try { r = await api("/api/auth/login", { method: "POST", body }); }
    catch (e) { if (/two-factor|totp/i.test(e.message || "")) return "totp"; throw e; }
    setSession(r);
    const me = await api("/api/me");
    const displayName = me.name || email.split("@")[0];
    setName(displayName);
    lastKnownStage.current = me.bankLinked ? "home" : "link";
    await persistSession({ token: r.token, refreshToken: r.refreshToken, name: displayName, onboarded: lastKnownStage.current });
    if (me.bankLinked) { refresh(); go("home"); } else { go("link"); }
  }

  async function handleSignup(fullName, email, password) {
    const r = await api("/api/auth/signup", {
      method: "POST",
      body: { fullName, email: email.toLowerCase(), password, country: "IN", deviceId: await getDeviceId(), consent: { tosVersion: "1.0", privacyVersion: "1.0" } },
    });
    setSession(r);
    setName(fullName);
    lastKnownStage.current = "link";
    await persistSession({ token: r.token, refreshToken: r.refreshToken, name: fullName, onboarded: "link" });
    go("link");
  }

  async function handleForgotRequest(email) {
    await api("/api/auth/password/reset-request", { method: "POST", body: { email: email.toLowerCase() } });
  }

  async function handleResetConfirm(token, newPassword) {
    await api("/api/auth/password/reset", { method: "POST", body: { token, newPassword } });
  }

  async function handleLink(details, linkPin) {
    const prefix = (details.ifsc || "").slice(0, 4).toUpperCase();
    const bank = BANK_BY_IFSC[prefix] || "HDFC Bank";
    await api("/api/accounts/link", { method: "POST", body: { bank, pin: linkPin, account: details.account, ifsc: details.ifsc, holderName: details.name } });
    lastKnownStage.current = "home";
    await markOnboarded("home");
    await refresh();
    go("home");
  }

  async function refresh({ quiet = true } = {}) {
    try {
      const a = await api("/api/accounts");
      setAccount(a);
      const h = await api("/api/payments");
      setHistory(h.payments || []);
    } catch (e) {
      if (!quiet && hasSession()) appAlert("Connection problem", "Couldn't refresh your account: " + humanError(e));
      return false;
    }
    try {
      const cts = await api("/api/contacts");
      setContacts(cts.contacts || []);
      const rq = await api("/api/requests");
      setRequests(rq.requests || []);
    } catch (e) { /* contacts/requests optional */ }
    if (!meta) api("/api/meta").then((m) => setMeta((prev) => prev || m)).catch(() => {});
    return true;
  }

  function startScan() { setFlow("pay"); setIntlMerchant(null); setQuote(null); setQuoteExpired(false); go("scan"); }
  function startSend() { setFlow("send"); setForm(EMPTY_FORM); setQuote(null); setQuoteExpired(false); go("send"); }
  function startScanDomestic() { setForm(EMPTY_FORM); setFlow("domestic"); scanLock.current = false; setWebScan("idle"); go("scanDom"); }
  function startDom(kind) { setForm(EMPTY_FORM); setFlow("domestic"); setPayeeVerified(false); setDomIntent({ kind }); go("compose"); }
  const startDomRecharge = () => startDom("recharge");
  const startDomBill = () => startDom("bill");
  const openAddMoney = () => startDom("topup");
  const openContacts = () => go("contacts");
  function openHelp() { setHelpFrom(screenRef.current); go("help"); }
  function openTxnDetail(p) { setSelectedTxn(p); go("txnDetail"); }

  async function getTransferQuote(currency, amount) {
    const amt = Number(amount !== undefined ? amount : form.amount);
    if (!(amt > 0)) throw new Error("Enter an amount first.");
    if (currency) lastSend.current = { currency, amount: amt };
    else lastSend.current = { ...lastSend.current, amount: amt };
    const q = await api("/api/transfers/quote", { method: "POST", body: { recipientCurrency: lastSend.current.currency, sendAmount: amt } });
    setFlow("send");
    setQuote({ ...q, currency: q.recipientCurrency, totalINR: q.total });
    setQuoteExpired(false);
    go("quote");
  }

  async function getIntlQuote(merchant) {
    const m = merchant || intlMerchant;
    if (!m) return;
    const q = await api("/api/quotes", { method: "POST", body: { currency: m.currency, localAmount: m.amount } });
    setFlow("pay");
    setQuote({ ...q, currency: m.currency, recipientAmount: m.amount, totalINR: q.total });
    setQuoteExpired(false);
    go("quote");
  }

  async function getQuote() {
    try {
      if (flow === "send") await getTransferQuote(lastSend.current.currency, lastSend.current.amount);
      else await getIntlQuote();
    } catch (e) { appAlert("Quote failed", humanError(e)); }
  }

  function useSampleQr() {
    const m = { name: "Test Store — Dubai Mall", currency: "AED", amount: 120 };
    setIntlMerchant(m);
    getIntlQuote(m).catch((e) => appAlert("Quote failed", humanError(e)));
  }

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
    setForm({ ...EMPTY_FORM, payeeName: parsed.name, vpa: parsed.vpa, amount: parsed.amount ? String(parsed.amount) : "", note: parsed.note });
    setFlow("domestic");
    setPayeeVerified(false);
    setDomIntent({ kind: "upi", title: parsed.name, sub: parsed.vpa + " \u2022 Scanned QR" });
    go("compose");
  }

  function useSampleUpiQr() { onQrScanned({ data: SAMPLE_UPI_QR }); }

  async function startWebScan() {
    if (webCameraCapable()) { scanLock.current = false; setWebScan("live"); return; }
    if (getSimPerm("camera") === "denied") {
      return appAlert("Camera access is turned off", "You declined camera access this session, so scanning is unavailable. You can still pay by entering a UPI ID. (Reload the page to be asked again.)");
    }
    const ok = await requestSimPerm("camera", {
      icon: "\uD83D\uDCF7",
      title: "\u201cBorderless Pay\u201d Would Like to Access the Camera",
      message: "Borderless Pay uses the camera only while you scan a payment QR code. Photos and video are never captured or stored.",
    });
    if (!ok) { return appAlert("Camera off", "No problem \u2014 enter a UPI ID instead."); }
    if (typeof __DEV__ !== "undefined" && __DEV__) return simScan();
    appAlert("No camera here", "This environment has no camera \u2014 pay by entering the UPI ID instead.");
  }

  function simScan() {
    setWebScan("sim");
    setTimeout(() => { setWebScan("idle"); onQrScanned({ data: SAMPLE_UPI_QR }); }, 1700);
  }

  function onWebCamError(e) {
    setWebScan("idle");
    const errName = e && e.name;
    if (errName === "NotAllowedError" || errName === "SecurityError") {
      appAlert("Camera access is turned off", "You denied the browser\u2019s camera permission, so live scanning is unavailable. Enable it in your browser\u2019s site settings, or pay by entering the UPI ID.");
    } else if (typeof __DEV__ !== "undefined" && __DEV__) {
      appAlert("Camera unavailable", "No usable camera was found \u2014 continuing with the simulated scanner (dev builds only).", [{ text: "OK", onPress: simScan }]);
    } else {
      appAlert("Camera unavailable", "No usable camera was found \u2014 pay by entering the UPI ID instead.");
    }
  }

  function payContact(ct) {
    setForm({ ...EMPTY_FORM, payeeName: ct.name, phone: ct.phone || "", vpa: ct.vpa || "" });
    setFlow("domestic"); setPayeeVerified(false);
    setDomIntent({ kind: "contact", title: "Pay " + ct.name, sub: ct.vpa || ct.phone });
    go("compose");
  }

  function payPhoneContact(c) {
    const phone = c.phoneNumbers && c.phoneNumbers[0] ? c.phoneNumbers[0].number : c.phone;
    setForm({ ...EMPTY_FORM, payeeName: c.name, phone: phone || "" });
    setFlow("domestic"); setPayeeVerified(false);
    setDomIntent({ kind: "phone", title: "Pay " + c.name, sub: phone });
    go("compose");
  }

  async function loadPhoneContacts() {
    if (IS_WEB) {
      if (getSimPerm("contacts") === "denied") {
        return appAlert("Contacts access is off", "You declined contacts access this session. Enter a UPI ID / phone number instead, or reload the page to be asked again.",
          [{ text: "Enter manually", onPress: () => startDom("phone") }, { text: "Cancel", style: "cancel" }]);
      }
      const ok = await requestSimPerm("contacts", {
        icon: "\uD83D\uDC65",
        title: "\u201cBorderless Pay\u201d Would Like to Access Your Contacts",
        message: "Borderless Pay reads your contacts only to let you pick who to pay. Matching happens on your device \u2014 your contact list is never uploaded or stored.",
      });
      if (!ok) { return appAlert("No problem", "You can still pay by entering a UPI ID or phone number.", [{ text: "Enter manually", onPress: () => startDom("phone") }, { text: "OK", style: "cancel" }]); }
      try {
        const { contacts: cts } = await api("/api/contacts");
        const mapped = (cts || []).filter((ct) => ct.phone).map((ct, i) => ({ id: "payee-" + i, name: ct.name, phoneNumbers: [{ number: ct.phone }] }));
        if (!mapped.length) return appAlert("No recent payees yet", "Pay someone once and they\u2019ll appear here. Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]);
        setPhoneContacts(mapped);
      } catch (e) { appAlert("Could not read contacts", "Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]); }
      return;
    }
    const { status, canAskAgain } = await Contacts.getPermissionsAsync();
    if (status !== "granted") {
      if (!canAskAgain) {
        return appAlert("Contacts access is off", "You\u2019ve turned off contacts access. Enable it in Settings to pick a contact, or just enter a UPI ID / phone number instead.",
          [{ text: "Enter manually", onPress: () => startDom("phone") }, { text: "Open settings", onPress: () => Linking.openSettings() }, { text: "Cancel", style: "cancel" }]);
      }
      appAlert("Pay a contact", "Borderless Pay will read your contacts only to let you pick who to pay. Matching happens on your device \u2014 your contact list is never uploaded or stored.",
        [{ text: "Not now", style: "cancel" }, { text: "Continue", onPress: async () => { const res = await Contacts.requestPermissionsAsync(); if (res.status === "granted") readDeviceContacts(); else appAlert("No problem", "You can still pay by entering a UPI ID or phone number.", [{ text: "OK", onPress: () => startDom("phone") }]); } }]);
      return;
    }
    readDeviceContacts();
  }

  async function readDeviceContacts() {
    try {
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const withPhones = (data || []).filter((c) => c.name && c.phoneNumbers && c.phoneNumbers.length);
      if (!withPhones.length) return appAlert("No contacts found", "Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]);
      setPhoneContacts(withPhones.slice(0, 50));
    } catch (e) { appAlert("Could not read contacts", "Enter a UPI ID or phone number instead.", [{ text: "OK", onPress: () => startDom("phone") }]); }
  }

  async function maybeOfferNotifications() {
    if (IS_WEB) {
      if (getSimPerm("notifications") !== "undetermined") return;
      const ok = await requestSimPerm("notifications", { icon: "\uD83D\uDD14", title: "\u201cBorderless Pay\u201d Would Like to Send You Notifications", message: "Get an instant receipt and a security alert for every payment. Optional \u2014 the app works fully without it." });
      if (ok) appAlert("Alerts on", "You\u2019ll get a receipt and a security alert for each payment.");
      return;
    }
    try {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status === "granted" || !canAskAgain) return;
      appAlert("Payment alerts?", "Get an instant receipt and a security alert for every payment. Optional \u2014 the app works fully without it.",
        [{ text: "No thanks", style: "cancel" }, { text: "Enable alerts", onPress: () => Notifications.requestPermissionsAsync() }]);
    } catch (e) { /* notifications unavailable */ }
  }

  async function verifyPayeeBestEffort() {
    const k = domIntent ? domIntent.kind : "upi";
    if (!["upi", "phone", "account", "contact"].includes(k)) return false;
    try {
      const r = await api("/api/payees/verify", { method: "POST", body: { vpa: form.vpa || undefined, phone: form.phone || undefined, account: form.account || undefined, ifsc: form.ifsc || undefined, name: form.payeeName || undefined } });
      if (r && r.name && !form.payeeName) updateForm({ payeeName: r.name });
      return Boolean(r && (r.verified === true || r.name));
    } catch { return false; }
  }

  async function proceedDomestic() {
    const amount = Number(form.amount);
    if (!(amount > 0)) throw new Error(domIntent && domIntent.kind === "topup" ? "Enter the amount you want to add." : "Enter the amount you want to pay.");
    setFlow("domestic");
    if (domIntent && domIntent.kind === "topup") { openAuth(); return; }
    const verified = await verifyPayeeBestEffort();
    setPayeeVerified(verified);
    go("review");
  }

  function buildDomesticRequest() {
    const amount = Number(form.amount);
    const k = domIntent ? domIntent.kind : "upi";
    if (k === "topup") return { endpoint: "/api/topup", body: { amount } };
    if (k === "payrequest") return { endpoint: "/api/requests/pay", body: { requestId: domIntent.requestId } };
    if (k === "recharge") return { endpoint: "/api/recharge", body: { amount, recharge: { operator: form.operator || "Airtel", number: form.phone, plan: "Custom" } } };
    if (k === "bill") return { endpoint: "/api/bills/pay", body: { amount, biller: { category: form.billCategory || "Electricity", name: form.biller || form.billCategory || "Biller", consumerId: form.consumerId } } };
    let payee;
    if (k === "account") payee = { kind: "upi", type: "bank", name: form.payeeName || "Bank account", account: form.account, ifsc: form.ifsc };
    else if (k === "upi") payee = { kind: "upi", type: "upi", name: form.payeeName || form.vpa || "UPI ID", vpa: form.vpa };
    else if (k === "phone") payee = { kind: "upi", type: "phone", name: form.payeeName || form.phone || "Payee", phone: form.phone };
    else payee = { kind: "upi", type: "contact", name: form.payeeName || "Payee", phone: form.phone, vpa: form.vpa };
    return { endpoint: "/api/upi/pay", body: { amount, payee } };
  }

  async function openAuth() {
    setPin(""); setAuthError(""); authInFlight.current = false;
    go("auth");
    runBiometric();
  }

  async function runBiometric() {
    try {
      if (IS_WEB) {
        const result = await simulateBiometric("Confirm it\u2019s you to authorize this payment");
        if (!result.success) setAuthError("Biometric check cancelled \u2014 enter your payment PIN to continue.");
        return;
      }
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
      if (!enrolled) return;
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Authorize your payment", cancelLabel: "Cancel", disableDeviceFallback: false });
      if (!result.success) setAuthError("Biometric check cancelled \u2014 enter your payment PIN to continue.");
    } catch (e) { /* hardware error \u2192 PIN remains */ }
  }

  function onPinKey(k) {
    if (busy) return;
    setAuthError("");
    setPin((prev) => (k === "del" ? prev.slice(0, -1) : prev.length < 4 ? prev + k : prev));
  }

  useEffect(() => {
    if (screen !== "auth" || pin.length !== 4) return;
    if (authInFlight.current) return;
    authInFlight.current = true;
    const id = setTimeout(() => authorize(pin), 150);
    return () => clearTimeout(id);
  }, [pin, screen]);

  function authExitScreen() {
    if (flow === "domestic") return domIntent && domIntent.kind === "payrequest" ? "home" : domIntent && domIntent.kind === "topup" ? "compose" : "review";
    return "quote";
  }

  async function authorize(enteredPin) {
    const steps = settleSteps;
    setSettleError(null); setSettleStepIndex(0); setBusy(true);
    go("settle");
    if (settleTimer.current) clearInterval(settleTimer.current);
    settleTimer.current = setInterval(() => {
      setSettleStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, 600);
    const idem = "idem_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    try {
      let endpoint, body;
      if (flow === "domestic") {
        const built = buildDomesticRequest();
        endpoint = built.endpoint;
        body = { ...built.body, pin: enteredPin };
      } else if (flow === "send") {
        endpoint = "/api/transfers";
        body = { quoteId: quote.quoteId, pin: enteredPin, recipient: { name: form.payeeName || "Recipient", country: quote.recipientCurrency } };
      } else {
        endpoint = "/api/payments";
        body = { quoteId: quote.quoteId, pin: enteredPin, merchant: { name: (intlMerchant && intlMerchant.name) || "Merchant", country: (intlMerchant && intlMerchant.currency) || quote.currency } };
      }
      const r = await api(endpoint, { method: "POST", idempotencyKey: idem, body });
      clearInterval(settleTimer.current);
      setSettleStepIndex(steps.length);
      setPin("");
      refresh();
      setTimeout(() => { setVerifyResult(null); setReceipt(r.receipt); go("receipt"); maybeOfferNotifications(); }, 450);
    } catch (e) {
      clearInterval(settleTimer.current);
      authInFlight.current = false;
      setPin("");
      if (/expired/i.test(e.message || "") && flow !== "domestic") {
        appAlert("Quote expired", "Rates lock for 60 seconds \u2014 fetching you a fresh quote.");
        getQuote(); return;
      }
      if (/incorrect pin/i.test(e.message || "")) {
        setAuthError(humanError(e) + " 5 wrong attempts lock your wallet.");
        go("auth"); return;
      }
      setSettleError(humanError(e));
    } finally { setBusy(false); }
  }

  function settleRetry() { setSettleError(null); openAuth(); }

  async function verifyReceipt() {
    if (!receipt || !receipt.settlement) return;
    try {
      const p = await api("/api/ledger/proof/" + receipt.settlement.index);
      if (p.blockHash !== receipt.settlement.hash) throw new Error("ledger block hash does not match this receipt");
      const root = foldMerkleProof(p.blockHash, p.path);
      if (root !== p.anchor.merkleRoot) throw new Error("Merkle path does not reach the anchor root");
      setVerifyResult({ ok: true });
    } catch (e) { setVerifyResult({ ok: false, error: humanError(e) }); }
  }

  function confirmLogout() {
    appAlert("Account", "Log out, or close your account permanently?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", onPress: logout },
      { text: "Close account", style: "destructive", onPress: () => appAlert("Close your account?", "Your profile data is erased immediately and every session is revoked. Transaction records are retained pseudonymously as required by law. This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Erase & close", style: "destructive", onPress: closeAccount }]) },
    ]);
  }

  async function closeAccount() {
    try { await api("/api/account/close", { method: "POST" }); appAlert("Account closed", "Your profile data has been erased and all sessions revoked."); }
    catch (e) { appAlert("Could not close account", humanError(e)); return; }
    await resetLocal();
  }

  async function logout() {
    try { await api("/api/logout", { method: "POST" }); } catch (e) { /* best effort */ }
    await resetLocal();
  }

  async function resetLocal() {
    setSession({});
    await clearPersistedSession().catch(() => {});
    setAccount(null); setHistory([]); setRequests([]); setContacts([]); setPhoneContacts([]);
    setReceipt(null); setQuote(null); setVerifyResult(null); setSelectedTxn(null);
    setPin(""); setAuthError(""); setName(""); setForm(EMPTY_FORM); setDomIntent(null); setIntlMerchant(null);
    go("welcome");
  }

  const mergedMeta = {
    ...(meta || {}),
    balance: account ? account.balance : 0,
    accountLast4: account && account.maskedNumber ? String(account.maskedNumber).replace(/[^0-9]/g, "").slice(-4) : "",
    bankName: account ? account.bank : "",
    payeeVerified,
  };

  const backTargetForCtx = (scr, opts) =>
    routeBackTarget(scr || screen, { flow, domIntentKind: domIntent && domIntent.kind, helpFrom, ...(opts || {}) });

  const ctx = {
    screen, setScreen: go, backTargetFor: backTargetForCtx,
    name, meta: mergedMeta, account, history, contacts, requests, phoneContacts,
    flow, domIntent, form, updateForm, intlMerchant, corridor: lastSend.current.currency,
    quote, quoteExpired, getQuote, getTransferQuote, proceedDomestic, useSampleQr,
    openAuth, pin, onPinKey, busy, error: authError, runBiometric,
    settleSteps, settleStepIndex, settleError, settleRetry,
    receipt, verifyResult, verifyReceipt,
    selectedTxn, openTxnDetail,
    helpFrom, openHelp,
    payContact, loadPhoneContacts, payPhoneContact,
    handleLogin, handleSignup, handleForgotRequest, handleResetConfirm, handleLink,
    unlockWithDevice, lockState, confirmLogout, refresh,
    startScan, startSend, startScanDomestic, startDomRecharge, startDomBill, openContacts, openAddMoney,
    webScan, setWebScan, startWebScan, onWebCamError, onQrScanned, camPerm, requestCamPerm, startDom, useSampleUpiQr,
  };

  const showTabs = ["home", "scanDom", "history", "contacts"].includes(screen);

  return (
    <AppContext.Provider value={ctx}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style={C.statusBar === "dark-content" ? "dark" : "light"} />
        <OfflineBanner visible={offline} />
        <View style={{ flex: 1, ...CONTENT }}>
          {screen === "boot" && <BootScreen />}
          {screen === "welcome" && <WelcomeScreen />}
          {screen === "signin" && <SigninScreen />}
          {screen === "signup" && <SignupScreen />}
          {screen === "forgot" && <ResetScreen />}
          {screen === "link" && <LinkScreen />}
          {screen === "lock" && <LockScreen />}
          {screen === "home" && <HomeScreen />}
          {screen === "scan" && <ScanScreen />}
          {screen === "send" && <SendScreen />}
          {screen === "scanDom" && <ScanDomScreen />}
          {screen === "compose" && <ComposeScreen />}
          {screen === "quote" && <QuoteScreen />}
          {screen === "review" && <ReviewScreen />}
          {screen === "auth" && <AuthScreen />}
          {screen === "settle" && <SettleScreen />}
          {screen === "receipt" && <ReceiptScreen />}
          {screen === "history" && <ActivityScreen />}
          {screen === "txnDetail" && <TxnDetailScreen />}
          {screen === "contacts" && <ContactsScreen />}
          {screen === "help" && <HelpScreen />}
        </View>
        {showTabs && <TabBar screen={screen} go={go} startScanDomestic={startScanDomestic} refresh={refresh} />}
        <AlertHost />
      </SafeAreaView>
    </AppContext.Provider>
  );
}

function ScanDomScreen() {
  const C = useTheme();
  const { setScreen, webScan, setWebScan, startWebScan, onWebCamError, onQrScanned, camPerm, requestCamPerm, startDom, useSampleUpiQr } = useApp();

  const scannerBox = { height: rs(230), borderRadius: 20, backgroundColor: C.bg2, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", overflow: "hidden" };
  const scanline = { position: "absolute", left: 16, right: 16, top: "20%", height: 2, backgroundColor: C.accent, opacity: 0.7 };

  const fallbackButtons = (
    <View>
      <PrimaryButton title="Enter UPI ID instead" secondary onPress={() => startDom("upi")} />
      {typeof __DEV__ !== "undefined" && __DEV__ ? <PrimaryButton title="Use sample QR (dev builds only)" secondary onPress={useSampleUpiQr} /> : null}
    </View>
  );

  const privacyCard = (
    <Card>
      <Text style={{ color: C.text, fontWeight: "700", marginBottom: 6 }}>Camera \u2014 only while you scan</Text>
      <Text style={{ color: C.muted, fontSize: rs(13), lineHeight: rs(19) }}>
        Borderless Pay uses the camera solely to read the payment QR in front of you. No photos or video are captured, stored, or uploaded \u2014 the QR is decoded on your device. Deny it and you can still pay by entering a UPI ID.
      </Text>
    </Card>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: rs(16) }}>
      <ScreenHeader title="Scan any UPI QR" onBack={() => { setWebScan("idle"); setScreen("home"); }} />
      {Platform.OS === "web" ? (
        webScan === "live" ? (
          <View>
            <View style={scannerBox}>
              <WebQrScanner onScanned={onQrScanned} onError={onWebCamError} />
              <View style={scanline} pointerEvents="none" />
            </View>
            <Text style={{ color: C.muted2, fontSize: rs(11), textAlign: "center", marginTop: 10 }}>Live camera \u2014 point at any UPI QR. Decoded on your device; nothing is photographed, stored, or uploaded.</Text>
            <PrimaryButton title="Stop camera" secondary onPress={() => setWebScan("idle")} />
            {fallbackButtons}
          </View>
        ) : webScan === "sim" ? (
          <View>
            <View style={scannerBox}>
              <ActivityIndicator color={C.accent} />
              <Text style={{ color: C.muted, marginTop: 8, fontWeight: "600" }}>Scanning \u2014 hold steady\u2026</Text>
              <View style={scanline} pointerEvents="none" />
            </View>
            <Text style={{ color: C.muted2, fontSize: rs(11), textAlign: "center", marginTop: 10 }}>Simulated camera (dev builds only). The sample UPI QR runs through the same upi:// parser as a real scan.</Text>
          </View>
        ) : (
          <View>{privacyCard}<PrimaryButton title="Allow camera & scan" onPress={startWebScan} />{fallbackButtons}</View>
        )
      ) : camPerm && camPerm.granted ? (
        <View>
          <View style={scannerBox}>
            <CameraView style={{ flex: 1, alignSelf: "stretch" }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onQrScanned} />
            <View style={scanline} pointerEvents="none" />
          </View>
          <Text style={{ color: C.muted2, fontSize: rs(11), textAlign: "center", marginTop: 10 }}>Point at any UPI QR \u2014 payee and amount fill in automatically. Nothing is photographed or stored.</Text>
          {fallbackButtons}
        </View>
      ) : camPerm && !camPerm.canAskAgain ? (
        <View>
          <Card>
            <Text style={{ color: C.text, fontWeight: "700", marginBottom: 6 }}>Camera access is turned off</Text>
            <Text style={{ color: C.muted, fontSize: rs(13), lineHeight: rs(19) }}>You previously denied camera access, so scanning is unavailable. You can enable it in your device Settings, or continue without the camera \u2014 everything still works.</Text>
          </Card>
          <PrimaryButton title="Open device settings" onPress={() => Linking.openSettings()} />
          {fallbackButtons}
        </View>
      ) : (
        <View>{privacyCard}<PrimaryButton title="Allow camera & scan" onPress={requestCamPerm} />{fallbackButtons}</View>
      )}
    </View>
  );
}

function TabBar({ screen, go, startScanDomestic, refresh }) {
  const C = useTheme();
  const tabs = [
    { key: "home", label: t("home"), icon: "home", onPress: () => go("home"), active: screen === "home" },
    { key: "scan", label: t("scan"), icon: "scan", onPress: startScanDomestic, active: screen === "scanDom" },
    { key: "activity", label: t("activity"), icon: "activity", onPress: () => { refresh(); go("history"); }, active: screen === "history" },
  ];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", alignItems: "stretch", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg2, paddingBottom: Platform.OS === "ios" ? 14 : 6, paddingTop: 6 }}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          accessibilityRole="tab"
          accessibilityLabel={tab.label}
          accessibilityState={{ selected: tab.active }}
          onPress={tab.onPress}
          activeOpacity={0.7}
          style={{ alignItems: "center", justifyContent: "center", minWidth: rs(72), minHeight: rs(48), paddingHorizontal: rs(10) }}
        >
          <Icon name={tab.icon} size={rs(22)} color={tab.active ? C.accent : C.muted} />
          <Text style={{ color: tab.active ? C.accent : C.muted, fontSize: rs(11), marginTop: 2, fontWeight: tab.active ? "700" : "500" }}>{tab.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function parseHashSafe(hash) {
  try {
    const { parseHash } = require("./src/routes");
    return parseHash(hash);
  } catch { return null; }
}
