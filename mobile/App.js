// Borderless Pay — React Native (Expo) app. Android + iOS.
import React, { useState, useEffect } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import { C, CORRIDORS, P2P_CURRENCIES, OPERATORS, BILL_CATEGORIES, BILLERS } from "./src/theme";
import { fmtINR } from "./src/format";
import { api, setToken } from "./src/api";
import { Brand, Card, Row, Pill, Badges, PrimaryButton, Chips, PinDots, PinPad } from "./src/ui";

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

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const c = CORRIDORS[corridor];
  const settleSteps = flow === "send" ? SEND_STEPS : flow === "domestic" ? DOMESTIC_STEPS : SETTLE_STEPS;
  const incomingRequest = requests.find((r) => r.direction === "incoming" && r.status === "pending");

  async function handleKyc() {
    setBusy(true);
    try {
      const r = await api("/api/kyc/verify", {
        method: "POST",
        body: { fullName: name || "Aarav Shah", documentId: "P" + Date.now(), country: "IN" },
      });
      setToken(r.token);
      setScreen("link");
    } catch (e) {
      Alert.alert("Verification failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLink() {
    if (newPin.length !== 4) return Alert.alert("Set a PIN", "Choose a 4-digit payment PIN first.");
    setBusy(true);
    try {
      await api("/api/accounts/link", {
        method: "POST",
        body: { bank, pin: newPin, openingBalance: 250000 },
      });
      await refresh();
      setScreen("home");
    } catch (e) {
      Alert.alert("Could not link", e.message);
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
    if (!(amt > 0)) return Alert.alert("Enter an amount", "How much would you like to send?");
    setBusy(true);
    try {
      const q = await api("/api/transfers/quote", {
        method: "POST",
        body: { recipientCurrency: p2pCurrency, sendAmount: amt },
      });
      setQuote(q);
      setScreen("quote");
    } catch (e) {
      Alert.alert("Quote failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  function startScanDomestic() {
    setForm(EMPTY_FORM);
    setFlow("domestic");
    setScanning(true);
    setScreen("scanDom");
    setTimeout(() => setScanning(false), 1500);
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

  function payIncomingRequest(r) {
    setForm({ ...EMPTY_FORM, amount: String(r.amount) });
    setDomIntent({ kind: "payrequest", requestId: r.id, title: "Pay request", sub: r.fromName + (r.note ? " • " + r.note : "") });
    setFlow("domestic");
    openAuth();
  }

  async function submitRequest() {
    const amount = Number(form.amount);
    if (!(amount > 0)) return Alert.alert("Enter an amount", "How much do you want to request?");
    setBusy(true);
    try {
      await api("/api/requests", {
        method: "POST",
        body: { amount, fromName: form.payeeName || form.phone || "Someone", note: form.note },
      });
      await refresh();
      Alert.alert("Request sent", "We'll notify you when it's paid.");
      setScreen("home");
    } catch (e) {
      Alert.alert("Could not send request", e.message);
    } finally {
      setBusy(false);
    }
  }

  function proceedDomestic() {
    const amount = Number(form.amount);
    if (!(amount > 0)) return Alert.alert("Enter an amount", "How much do you want to pay?");
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
    else if (k === "upiid") payee = { kind: "upi", type: "upi", name: form.vpa || "UPI ID", vpa: form.vpa };
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
      Alert.alert("Quote failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openAuth() {
    setPin("");
    setScreen("auth");
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
      if (enrolled) {
        await LocalAuthentication.authenticateAsync({
          promptMessage: "Authorize your payment",
          fallbackLabel: "Use PIN",
        });
      }
    } catch (e) {
      // biometrics optional; PIN still required
    }
  }

  function onPinKey(k) {
    setPin((prev) => {
      const v = k === "del" ? prev.slice(0, -1) : prev.length < 4 ? prev + k : prev;
      if (v.length === 4) setTimeout(() => authorize(v), 150);
      return v;
    });
  }

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
        setReceipt(r.receipt);
        await refresh();
        setScreen("receipt");
      }, steps.length * 520 + 300);
    } catch (e) {
      Alert.alert("Could not complete", e.message);
      setScreen(flow === "domestic" ? (domIntent && domIntent.kind !== "payrequest" ? "compose" : "home") : "quote");
    }
  }

  async function verifyLedger() {
    try {
      const v = await api("/api/ledger/verify");
      Alert.alert(
        v.ok ? "✓ Ledger intact" : "✗ Tampering detected",
        v.ok ? v.blocks + " blocks • " + v.anchors + " anchors verified" : String(v.reason)
      );
    } catch (e) {
      Alert.alert("Error", e.message);
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

  const showTabs = ["home", "scan", "scanDom", "send", "compose", "history", "quote", "receipt"].includes(screen);

  return (
    <SafeAreaView style={s.app}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {screen === "welcome" && (
          <View>
            <Brand />
            <Text style={s.h1}>Pay anywhere, straight from your bank.</Text>
            <Text style={s.sub}>
              Spend abroad at the real mid-market rate with a flat 0.5% fee. No wallets, no hidden FX
              markup, no surprises.
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
            <PrimaryButton title="Verify identity (KYC) →" onPress={handleKyc} loading={busy} />
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
          </View>
        )}

        {screen === "home" && (
          <View>
            <Brand />
            <Card>
              <Text style={s.muted}>Available balance</Text>
              <Text style={s.balance}>{fmtINR(account ? account.balance : 0)}</Text>
              <Pill>{account ? account.bank + " • " + account.maskedNumber : "Bank"}</Pill>
              <Badges items={["🔐 scrypt PIN", "⛓️ dual ledger", "✍️ HMAC signed"]} />
            </Card>

            {incomingRequest && (
              <Card style={[{ borderColor: C.accent }]}>
                <Text style={[{ color: C.text, fontWeight: "700", marginBottom: 4 }]}>
                  💰 {incomingRequest.fromName} requested {fmtINR(incomingRequest.amount)}
                </Text>
                <Text style={[{ color: C.muted, fontSize: 13, marginBottom: 10 }]}>
                  {incomingRequest.note || "Payment request"}
                </Text>
                <PrimaryButton title={"Pay " + fmtINR(incomingRequest.amount)} onPress={() => payIncomingRequest(incomingRequest)} />
              </Card>
            )}

            <Text style={s.section}>Money transfer</Text>
            <View style={s.grid}>
              <ActionTile icon="📷" label="Scan QR" onPress={startScanDomestic} />
              <ActionTile icon="📱" label="To phone" onPress={() => startDom("phone")} />
              <ActionTile icon="🆔" label="To UPI ID" onPress={() => startDom("upiid")} />
              <ActionTile icon="🏦" label="To bank" onPress={() => startDom("bank")} />
              <ActionTile icon="🔁" label="Request" onPress={() => startDom("request")} />
            </View>

            <Text style={s.section}>Recharge & bills</Text>
            <View style={s.grid}>
              <ActionTile icon="📲" label="Recharge" onPress={() => startDom("recharge")} />
              <ActionTile icon="🧾" label="Pay bills" onPress={() => startDom("bill")} />
              <ActionTile icon="💡" label="Electricity" onPress={() => startDom("bill")} />
              <ActionTile icon="📺" label="DTH" onPress={() => startDom("bill")} />
            </View>

            <Text style={s.section}>International 🌍</Text>
            <View style={s.grid}>
              <ActionTile icon="💸" label="Send abroad" onPress={startSend} tint="#15324d" />
              <ActionTile icon="🧳" label="Pay abroad" onPress={startScan} tint="#15324d" />
              <ActionTile icon="🔎" label="Verify" onPress={verifyLedger} tint="#15324d" />
            </View>

            {contacts.length > 0 && (
              <View>
                <Text style={s.section}>People</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[{ marginBottom: 8 }]}>
                  {contacts.map((ct) => (
                    <TouchableOpacity key={ct.vpa || ct.phone} style={s.person} activeOpacity={0.8} onPress={() => payContact(ct)}>
                      <View style={s.avatar}>
                        <Text style={[{ color: "#04122b", fontWeight: "800" }]}>{ct.initials}</Text>
                      </View>
                      <Text style={s.personName} numberOfLines={1}>{ct.name.split(" ")[0]}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={s.section}>Recent</Text>
            <HistoryList history={history} />
          </View>
        )}

        {screen === "scan" && (
          <View>
            <Text style={s.h2}>Scan to pay</Text>
            <View style={s.scanner}>
              <View style={s.qr}>
                {Array.from({ length: 25 }).map((_, i) => (
                  <View key={i} style={[s.qrCell, i % 3 === 0 && { backgroundColor: "#000" }, i % 5 === 0 && { backgroundColor: "#000" }]} />
                ))}
              </View>
            </View>
            {scanning ? (
              <ActivityIndicator color={C.accent} size="large" style={[{ marginTop: 30 }]} />
            ) : (
              <View>
                <Card style={[{ marginTop: 16 }]}>
                  <Row label="Merchant" value={c.merchant} />
                  <Row label="Location" value={c.flag + " " + c.country} />
                  <Row label="Status" value="✓ Verified merchant" accent />
                </Card>
                <PrimaryButton title="Continue" onPress={getQuote} loading={busy} />
              </View>
            )}
          </View>
        )}

        {screen === "send" && (
          <View>
            <Text style={s.h2}>Send money</Text>
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
              keyboardType="number-pad"
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
            <Card>
              <Row label="They receive" value={symFor(quote.recipientCurrency) + " " + quote.recipientAmount.toLocaleString()} accent />
              <Row label="Exchange rate (mid-market)" value={"1 " + quote.recipientCurrency + " = ₹" + quote.rate} />
              <Row label="You send" value={fmtINR(quote.sendAmount)} />
              <Row label="FX markup" value="₹0.00" accent />
              <Row label="Borderless fee (0.5%)" value={fmtINR(quote.fee)} />
              <Row label="Total from bank" value={fmtINR(quote.total)} accent big />
            </Card>
            <Text style={s.savings}>Real rate, no markup — they get every rupee converted fairly.</Text>
            <PrimaryButton title="Slide to send 🔒" onPress={openAuth} />
          </View>
        )}

        {screen === "quote" && quote && quote.kind !== "p2p" && (
          <View>
            <Text style={s.h2}>Confirm payment</Text>
            <Text style={s.sub}>{c.merchant}</Text>
            <Card>
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
            <PrimaryButton title="Slide to pay 🔒" onPress={openAuth} />
          </View>
        )}

        {screen === "scanDom" && (
          <View>
            <Text style={s.h2}>Scan any QR</Text>
            <View style={s.scanner}>
              <View style={s.qr}>
                {Array.from({ length: 25 }).map((_, i) => (
                  <View key={i} style={[s.qrCell, i % 3 === 0 && { backgroundColor: "#000" }, i % 5 === 0 && { backgroundColor: "#000" }]} />
                ))}
              </View>
            </View>
            {scanning ? (
              <ActivityIndicator color={C.accent} size="large" style={[{ marginTop: 30 }]} />
            ) : (
              <View>
                <Card style={[{ marginTop: 16 }]}>
                  <Row label="Merchant" value="Cafe Coffee Day" />
                  <Row label="UPI ID" value="ccd@bpl" />
                  <Row label="Status" value="✓ Verified merchant" accent />
                </Card>
                <PrimaryButton
                  title="Enter amount"
                  onPress={() => {
                    setForm({ ...EMPTY_FORM, payeeName: "Cafe Coffee Day" });
                    setDomIntent({ kind: "merchant", title: "Cafe Coffee Day", sub: "ccd@bpl • Verified merchant" });
                    setScreen("compose");
                  }}
                />
              </View>
            )}
          </View>
        )}

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
            <TextInput style={s.input} placeholder="0" placeholderTextColor={C.muted} keyboardType="number-pad" value={form.amount} onChangeText={(v) => setF("amount", v)} />

            {(domIntent.kind === "phone" || domIntent.kind === "upiid" || domIntent.kind === "contact" || domIntent.kind === "bank" || domIntent.kind === "merchant") && (
              <View>
                <Text style={s.label}>Note (optional)</Text>
                <TextInput style={s.input} placeholder="What's it for?" placeholderTextColor={C.muted} value={form.note} onChangeText={(v) => setF("note", v)} />
              </View>
            )}

            <Card>
              <Row label="You pay" value={fmtINR(Number(form.amount) || 0)} accent big />
              <Row label="Fee" value="₹0 • Free" accent />
              <Row label="Speed" value="Instant" />
            </Card>

            {domIntent.kind === "request" ? (
              <PrimaryButton title="Send request" onPress={submitRequest} loading={busy} />
            ) : (
              <PrimaryButton title={"Proceed to pay " + fmtINR(Number(form.amount) || 0)} onPress={proceedDomestic} />
            )}
          </View>
        )}

        {screen === "auth" && (
          <View>
            <Text style={[s.h2, { textAlign: "center" }]}>🔒 Authorize</Text>
            <Text style={[s.sub, { textAlign: "center" }]}>Face ID + enter your PIN</Text>
            <Text style={[{ fontSize: 64, textAlign: "center", marginVertical: 10 }]}>👤</Text>
            <PinDots filled={pin.length} />
            <PinPad onKey={onPinKey} />
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
            <View style={s.check}>
              <Text style={[{ color: "#04122b", fontSize: 44, fontWeight: "800" }]}>✓</Text>
            </View>
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
            </Card>
            <PrimaryButton title="Done" onPress={() => setScreen("home")} />
          </View>
        )}

        {screen === "history" && (
          <View>
            <Text style={s.h2}>Activity</Text>
            <HistoryList history={history} />
          </View>
        )}
      </ScrollView>

      {showTabs && (
        <View style={s.tabbar}>
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
      )}
    </SafeAreaView>
  );
}

function ActionTile({ icon, label, onPress, tint }) {
  return (
    <TouchableOpacity style={s.tile} activeOpacity={0.8} onPress={onPress}>
      <View style={[s.tileIcon, tint && { backgroundColor: tint }]}>
        <Text style={[{ fontSize: 22 }]}>{icon}</Text>
      </View>
      <Text style={s.tileLbl} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function Tab({ label, icon, active, onPress }) {
  return (
    <TouchableOpacity style={s.tab} onPress={onPress}>
      <Text style={[{ fontSize: 20 }]}>{icon}</Text>
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
  scroll: { padding: 22, paddingBottom: 110 },
  h1: { color: C.text, fontSize: 26, fontWeight: "800", marginBottom: 8, letterSpacing: -0.5 },
  h2: { color: C.text, fontSize: 20, fontWeight: "700", marginBottom: 12 },
  sub: { color: C.muted, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  label: { color: C.muted, fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: C.card2, borderColor: "#2b3a6b", borderWidth: 1, borderRadius: 12, padding: 14, color: C.text, fontSize: 15, marginBottom: 12 },
  muted: { color: C.muted, fontSize: 13 },
  balance: { color: C.text, fontSize: 34, fontWeight: "800", marginVertical: 6, letterSpacing: -1 },
  savings: { color: C.accent, fontSize: 12, textAlign: "center", marginVertical: 6 },
  scanner: { height: 230, borderRadius: 18, backgroundColor: "#0e1730", borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  qr: { width: 120, height: 120, backgroundColor: "#fff", borderRadius: 10, flexDirection: "row", flexWrap: "wrap", padding: 8 },
  qrCell: { width: "20%", height: "20%", backgroundColor: "#fff" },
  stepRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#33406b", alignItems: "center", justifyContent: "center", marginRight: 12 },
  stepDotDone: { backgroundColor: C.accent, borderColor: C.accent },
  stepTxt: { color: C.muted, fontSize: 15, flex: 1 },
  check: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", alignSelf: "center", marginVertical: 16 },
  hashLbl: { color: C.muted, fontSize: 12, marginTop: 8 },
  hash: { color: C.muted, fontSize: 11, fontFamily: "monospace", backgroundColor: "#0c1430", padding: 8, borderRadius: 8, marginTop: 4 },
  txn: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1b2546" },
  txnIc: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.card2, alignItems: "center", justifyContent: "center", marginRight: 10 },
  tabbar: { position: "absolute", bottom: 0, left: 0, right: 0, height: 74, backgroundColor: "#0a1024", borderTopWidth: 1, borderTopColor: "#1b2546", flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingBottom: 8 },
  tab: { alignItems: "center" },
  tabTxt: { color: C.muted, fontSize: 11, marginTop: 3 },
  section: { color: C.text, fontSize: 15, fontWeight: "700", marginTop: 18, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "22%", alignItems: "center", marginBottom: 6 },
  tileIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: C.card2, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  tileLbl: { color: C.muted, fontSize: 11, textAlign: "center" },
  person: { alignItems: "center", marginRight: 16, width: 58 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  personName: { color: C.muted, fontSize: 12 },
});
