// Review screen — shown before the PIN/auth step for EVERY payment.
// Implements the recommended hierarchy:
//   1. Verified recipient
//   2. Amount and currency
//   3. Exchange rate and fee
//   4. Total debit
//   5. Funding account
//   6. Settlement status (domestic: instant UPI; international: FX rails)
//   7. Help / report issue link
//   8. Technical details expandable
import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { useApp } from "./context.js";
import { Card, Row, PrimaryButton, Pill, Expandable, ScreenHeader } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { fmtINR } from "../format.js";

export function ReviewScreen() {
  const C = useTheme();
  const { form, quote, flow, domIntent, meta, openAuth, setScreen, backTargetFor, screen } = useApp();

  const isDomestic = flow === "domestic";
  const payeeName = form.payeeName || form.vpa || form.phone || "Payee";
  const verified = Boolean(meta && meta.payeeVerified);
  const amtINR = form.amount ? fmtINR(Number(form.amount)) : "—";
  const currency = isDomestic ? "INR" : (quote && quote.currency) || "";
  const recipientAmt = quote ? quote.recipientAmount : null;
  const rate = quote ? quote.rate : null;
  const fee = isDomestic ? "0" : (quote ? quote.fee : null);
  const total = isDomestic ? form.amount : (quote ? quote.totalINR : null);
  const fundingLabel = meta && meta.accountLast4 ? `Bank ••••${meta.accountLast4}` : "Your Borderless balance";
  const settlement = isDomestic ? "Instant UPI" : (quote && quote.settlementMode) || "FX rails";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader
        title={t("review_payment")}
        onBack={() => setScreen && setScreen(backTargetFor ? backTargetFor("review", { domIntentKind: domIntent && domIntent.kind }) : "compose")}
      />
      <ScrollView contentContainerStyle={{ padding: rs(16) }}>
        {/* 1. Recipient */}
        <Card style={{ marginBottom: rs(12) }}>
          <Text style={{ fontSize: rs(12), color: C.muted, marginBottom: rs(4), fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>
            {t("recipient")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: rs(4) }}>
            <Text style={{ fontSize: rs(20), fontWeight: "700", color: C.text, flex: 1 }}>{payeeName}</Text>
            {verified ? (
              <Pill label={t("verified_recipient")} color={C.good} />
            ) : (
              <Pill label={t("unverified_recipient")} color={C.warn} />
            )}
          </View>
          {form.vpa ? <Text style={{ fontSize: rs(13), color: C.muted }}>{form.vpa}</Text> : null}
          {form.account ? <Text style={{ fontSize: rs(13), color: C.muted }}>A/C ••••{String(form.account).slice(-4)} · {form.ifsc}</Text> : null}
        </Card>

        {/* 2-5. Payment amounts */}
        <Card style={{ marginBottom: rs(12) }}>
          <Row label={t("amount")} value={amtINR} big />
          {!isDomestic && recipientAmt && (
            <Row label={t("they_receive")} value={`${currency} ${Number(recipientAmt).toLocaleString()}`} />
          )}
          {!isDomestic && rate && (
            <Row label={t("rate")} value={`1 ${currency} = ${fmtINR(rate)}`} />
          )}
          <Row label={t("fee")} value={isDomestic ? `${fmtINR(0)} (free)` : fmtINR(fee)} />
          <View style={{ height: 1, backgroundColor: C.line, marginVertical: rs(8) }} />
          <Row label={t("total_debit")} value={fmtINR(total || form.amount)} accent big />
        </Card>

        {/* 5. Funding account */}
        <Card style={{ marginBottom: rs(12) }}>
          <Row label={t("funding_account")} value={fundingLabel} />
          <Row label={t("settlement_status")} value={settlement} />
        </Card>

        {/* 7. Help */}
        <TouchableOpacity
          onPress={() => setScreen && setScreen("help")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="link"
          accessibilityLabel={t("get_help")}
          style={{ marginBottom: rs(16), alignItems: "center" }}
        >
          <Text style={{ fontSize: rs(13), color: C.accent }}>{t("get_help")} →</Text>
        </TouchableOpacity>

        <PrimaryButton title={t("authorize")} onPress={() => openAuth && openAuth()} />
      </ScrollView>
    </View>
  );
}
