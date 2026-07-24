// Pay screens: send-abroad, compose (all domestic kinds), quote.
import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, FlatList } from "react-native";
import { useApp } from "./context.js";
import { ScreenHeader, Card, Field, PrimaryButton, Chips, Row } from "../ui.js";
import { useTheme, CORRIDORS, OPERATORS, BILL_CATEGORIES, BILLERS } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { sanitizeAmount, amountIssue, vpaIssue, phoneIssue, ifscIssue, accountIssue, accountsMatch, nameIssue, consumerIdIssue } from "../validation.js";
import { fmtINR } from "../format.js";

// ── Send (international manual) ─────────────────────────────────────────────────────────
export function SendScreen() {
  const C = useTheme();
  const { setScreen, form, updateForm, getTransferQuote, account } = useApp();
  const corridorKeys = Object.keys(CORRIDORS);
  const [corridor, setCorridor] = useState(corridorKeys[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const corr = CORRIDORS[corridor];
  const amtErr = form.amount ? amountIssue(form.amount) : null;

  const onQuote = async () => {
    setErr(""); setBusy(true);
    try { await getTransferQuote && getTransferQuote(corridor, form.amount); }
    catch (e) { setErr(e.message || t("error_generic")); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader title={t("send")} onBack={() => setScreen && setScreen("home")} />
      <ScrollView contentContainerStyle={{ padding: rs(16) }}>
        <Text style={{ fontSize: rs(13), color: C.muted, marginBottom: rs(4) }}>{t("corridor")}</Text>
        <Chips
          options={corridorKeys.map((k) => ({ value: k, label: CORRIDORS[k].flag + " " + CORRIDORS[k].country }))}
          value={corridor}
          onChange={setCorridor}
        />
        <Field
          label={`${t("amount_foreign", { currency: corridor })} (${corr.sym})`}
          value={form.amount || ""}
          onChangeText={(v) => updateForm && updateForm({ amount: sanitizeAmount(v) })}
          keyboardType="decimal-pad"
          error={amtErr ? t(amtErr) : ""}
          style={{ marginTop: rs(16) }}
        />
        <Field
          label="Recipient name"
          value={form.payeeName || ""}
          onChangeText={(v) => updateForm && updateForm({ payeeName: v })}
          autoCapitalize="words"
        />
        {Boolean(err) && <Text style={{ color: C.danger }} accessibilityRole="alert">{err}</Text>}
        <PrimaryButton
          title={t("get_quote")}
          onPress={onQuote}
          loading={busy}
          disabled={Boolean(amtErr) || !form.amount}
          style={{ marginTop: rs(8) }}
        />
      </ScrollView>
    </View>
  );
}

// ── Compose (domestic UPI / account / phone) ────────────────────────────────────────────
export function ComposeScreen() {
  const C = useTheme();
  const { setScreen, form, updateForm, proceedDomestic, domIntent } = useApp();
  const kind = (domIntent && domIntent.kind) || "upi";
  const [confirmAccount, setConfirmAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const amtErr = form.amount ? amountIssue(form.amount) : null;
  const vpaErr = kind === "upi" && form.vpa ? vpaIssue(form.vpa) : null;
  const phoneErr = kind === "phone" && form.phone ? phoneIssue(form.phone) : null;
  const accountErr = kind === "account" && form.account ? accountIssue(form.account) : null;
  const confirmErr = kind === "account" && confirmAccount && !accountsMatch(form.account, confirmAccount)
    ? t("account_mismatch") : null;

  const onProceed = async () => {
    if (kind === "account" && !accountsMatch(form.account, confirmAccount)) {
      setErr(t("account_mismatch")); return;
    }
    setErr(""); setBusy(true);
    try { await proceedDomestic && proceedDomestic(); }
    catch (e) { setErr(e.message || t("error_generic")); }
    finally { setBusy(false); }
  };

  const title = kind === "upi" ? "Pay via UPI ID" :
                kind === "phone" ? "Pay to mobile number" :
                kind === "account" ? "Pay to bank account" :
                kind === "recharge" ? t("mobile_recharge") :
                kind === "bill" ? t("pay_bills") : t("pay");

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader title={title} onBack={() => setScreen && setScreen("home")} />
      <ScrollView contentContainerStyle={{ padding: rs(16) }}>
        {/* Amount (all kinds) */}
        <Field
          label={t("amount_inr")}
          value={form.amount || ""}
          onChangeText={(v) => updateForm && updateForm({ amount: sanitizeAmount(v) })}
          keyboardType="decimal-pad"
          error={amtErr ? t(amtErr) : ""}
        />

        {/* UPI */}
        {kind === "upi" && (
          <Field
            label={t("upi_id")}
            value={form.vpa || ""}
            onChangeText={(v) => updateForm && updateForm({ vpa: v })}
            keyboardType="email-address"
            error={vpaErr ? t(vpaErr) : ""}
            placeholder="name@bank"
          />
        )}

        {/* Phone */}
        {kind === "phone" && (
          <Field
            label={t("mobile_number")}
            value={form.phone || ""}
            onChangeText={(v) => updateForm && updateForm({ phone: v })}
            keyboardType="phone-pad"
            error={phoneErr ? t(phoneErr) : ""}
          />
        )}

        {/* Bank account with confirm */}
        {kind === "account" && (
          <>
            <Field
              label={t("account_holder")}
              value={form.payeeName || ""}
              onChangeText={(v) => updateForm && updateForm({ payeeName: v })}
              autoCapitalize="words"
              error={form.payeeName && nameIssue(form.payeeName) ? t("name_invalid") : ""}
            />
            <Field
              label={t("account_number")}
              value={form.account || ""}
              onChangeText={(v) => updateForm && updateForm({ account: v })}
              keyboardType="number-pad"
              error={accountErr ? t(accountErr) : ""}
            />
            <Field
              label={t("confirm_account")}
              value={confirmAccount}
              onChangeText={setConfirmAccount}
              keyboardType="number-pad"
              error={confirmErr || ""}
            />
            <Field
              label={t("ifsc")}
              value={form.ifsc || ""}
              onChangeText={(v) => updateForm && updateForm({ ifsc: v.toUpperCase() })}
              maxLength={11}
              autoCapitalize="characters"
              error={form.ifsc && ifscIssue(form.ifsc) ? t("ifsc_invalid") : ""}
            />
          </>
        )}

        {/* Recharge */}
        {kind === "recharge" && (
          <>
            <Field
              label={t("mobile_number")}
              value={form.phone || ""}
              onChangeText={(v) => updateForm && updateForm({ phone: v })}
              keyboardType="phone-pad"
              error={form.phone && phoneIssue(form.phone) ? t("phone_invalid") : ""}
            />
            <Text style={{ fontSize: rs(12), color: C.muted, marginBottom: rs(4) }}>{t("operator")}</Text>
            <Chips
              options={OPERATORS.map((o) => ({ value: o, label: o }))}
              value={form.operator || ""}
              onChange={(v) => updateForm && updateForm({ operator: v })}
            />
          </>
        )}

        {/* Bill */}
        {kind === "bill" && (
          <>
            <Text style={{ fontSize: rs(12), color: C.muted, marginTop: rs(8), marginBottom: rs(4) }}>{t("bill_category")}</Text>
            <Chips
              options={BILL_CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={form.billCategory || ""}
              onChange={(v) => updateForm && updateForm({ billCategory: v, biller: "" })}
            />
            {form.billCategory && BILLERS[form.billCategory] && (
              <>
                <Text style={{ fontSize: rs(12), color: C.muted, marginTop: rs(12), marginBottom: rs(4) }}>{t("biller")}</Text>
                <Chips
                  options={(BILLERS[form.billCategory] || []).map((b) => ({ value: b, label: b }))}
                  value={form.biller || ""}
                  onChange={(v) => updateForm && updateForm({ biller: v })}
                />
              </>
            )}
            <Field
              label={t("consumer_id")}
              value={form.consumerId || ""}
              onChangeText={(v) => updateForm && updateForm({ consumerId: v })}
              error={form.consumerId && consumerIdIssue(form.consumerId) ? t("consumer_invalid") : ""}
            />
          </>
        )}

        <Field
          label={t("note")}
          value={form.note || ""}
          onChangeText={(v) => updateForm && updateForm({ note: v })}
          autoCapitalize="sentences"
        />

        {Boolean(err) && (
          <Text style={{ color: C.danger, marginBottom: rs(8) }} accessibilityRole="alert">{err}</Text>
        )}

        <PrimaryButton
          title="Review payment"
          onPress={onProceed}
          loading={busy}
          disabled={Boolean(amtErr) || !form.amount}
          style={{ marginTop: rs(8) }}
        />
      </ScrollView>
    </View>
  );
}

// ── Quote screen (international, shown after QR scan or send-abroad) ───────────────────
export function QuoteScreen() {
  const C = useTheme();
  const { setScreen, quote, quoteExpired, getQuote, openAuth, flow, intlMerchant } = useApp();
  const [busy, setBusy] = useState(false);

  if (!quote && !quoteExpired) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: C.muted }}>{t("loading")}</Text>
      </View>
    );
  }

  if (quoteExpired) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", alignItems: "center", padding: rs(32) }}>
        <Text style={{ fontSize: rs(18), color: C.warn, textAlign: "center", marginBottom: rs(24) }}>
          {t("quote_expired")}
        </Text>
        <PrimaryButton title={t("get_quote")} onPress={() => getQuote && getQuote()} loading={busy} />
      </View>
    );
  }

  const corr = CORRIDORS[quote.currency] || {};

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader
        title={t("review_payment")}
        onBack={() => setScreen && setScreen("send")}
      />
      <ScrollView contentContainerStyle={{ padding: rs(16) }}>
        <Card style={{ marginBottom: rs(12) }}>
          <Text style={{ fontSize: rs(13), color: C.muted, marginBottom: rs(8) }}>
            {intlMerchant ? intlMerchant.name : "Transfer"}
          </Text>
          <Row label={t("they_receive")} value={`${quote.currency} ${Number(quote.recipientAmount).toLocaleString()}`} big />
          <Row label={t("exchange_rate")} value={`1 ${quote.currency} = ${fmtINR(quote.rate)}`} />
          <Row label={t("fee")} value={fmtINR(quote.fee)} />
          <View style={{ height: 1, backgroundColor: C.line, marginVertical: rs(8) }} />
          <Row label={t("total_debit")} value={fmtINR(quote.totalINR)} accent big />
        </Card>
        <PrimaryButton title={t("authorize")} onPress={() => openAuth && openAuth()} style={{ marginTop: rs(8) }} />
      </ScrollView>
    </View>
  );
}
