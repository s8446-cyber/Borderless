// Receipt screen — payment-review hierarchy:
//   Recipient → Amount → Rate+Fee → Total → Funding → Status → Help → Tech details (expandable)
import React from "react";
import { View, Text, ScrollView, Share, TouchableOpacity } from "react-native";
import { useApp } from "./context.js";
import { Card, Row, PrimaryButton, Expandable, HashText, ScreenHeader, Pill } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { fmtINR } from "../format.js";
import { buildReceiptShareText, receiptRecipient } from "../receiptText.js";

export function ReceiptScreen() {
  const C = useTheme();
  const { receipt, setScreen, meta, verifyResult, verifyReceipt } = useApp();

  if (!receipt) return null;

  const rec = receipt;
  const recipient = receiptRecipient(rec);
  const isDomestic = Boolean(rec.domestic);
  const fundingLabel = meta && meta.accountLast4 ? `Bank ••••${meta.accountLast4}` : "Borderless balance";
  const statusText = rec.settlementMode === "sandbox" ? "Completed (sandbox — simulated rails)" : "Completed";

  const onShare = async () => {
    const text = buildReceiptShareText(rec, { fundingLabel });
    try { await Share.share({ message: text }); } catch { /* user dismissed */ }
  };

  const onVerify = () => verifyReceipt && verifyReceipt(rec);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader
        title={t("receipt")}
        onBack={() => setScreen && setScreen("home")}
        rightElement={
          <TouchableOpacity onPress={onShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={t("share_receipt")}>
            <Text style={{ fontSize: rs(13), color: C.accent }}>{t("share_receipt")}</Text>
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={{ padding: rs(16) }}>

        {/* 1. Recipient */}
        <Card style={{ marginBottom: rs(12) }}>
          <Text style={{ fontSize: rs(11), color: C.muted, marginBottom: rs(4), textTransform: "uppercase", letterSpacing: 0.6 }}>{t("recipient")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ fontSize: rs(20), fontWeight: "700", color: C.text, flex: 1 }}>{recipient}</Text>
            <Pill label={t("verify_badge")} color={C.good} />
          </View>
        </Card>

        {/* 2-4. Amount / rate / fee / total */}
        <Card style={{ marginBottom: rs(12) }}>
          {!isDomestic && rec.recipientAmount && (
            <Row label={t("they_receive")} value={`${rec.currency} ${Number(rec.recipientAmount).toLocaleString()}`} />
          )}
          <Row label={t("amount")} value={fmtINR(rec.amount !== undefined ? rec.amount : rec.total)} />
          {!isDomestic && rec.rate && (
            <Row label={t("rate")} value={`1 ${rec.currency} = ${fmtINR(rec.rate)}`} />
          )}
          <Row label={t("fee")} value={isDomestic ? `${fmtINR(0)} (free)` : fmtINR(rec.fee)} />
          <View style={{ height: 1, backgroundColor: C.line, marginVertical: rs(8) }} />
          <Row label={t("total_debit")} value={fmtINR(rec.total)} accent big />
        </Card>

        {/* 5-6. Funding + status */}
        <Card style={{ marginBottom: rs(12) }}>
          <Row label={t("funding_account")} value={fundingLabel} />
          <Row label={t("settlement_status")} value={statusText} />
          {rec.reference && <Row label="Reference" value={rec.reference} />}
        </Card>

        {/* 7. Help / dispute / report fraud */}
        <Card style={{ marginBottom: rs(12) }}>
          <Text style={{ fontSize: rs(13), color: C.muted, marginBottom: rs(12) }}>{t("get_help")}</Text>
          <PrimaryButton
            title={t("dispute")}
            onPress={() => setScreen && setScreen("help")}
            secondary
            style={{ marginBottom: rs(8) }}
          />
          <PrimaryButton
            title={t("report_fraud")}
            onPress={() => setScreen && setScreen("help")}
            secondary
            destructive
          />
        </Card>

        {/* 8. Technical verification details (expandable) */}
        <Card>
          <Expandable title={t("tech_details")}>
            {rec.settlement && rec.settlement.hash && (
              <HashText label={t("settlement_hash")} value={rec.settlement.hash} />
            )}
            {rec.anchor && rec.anchor.publicTxHash && (
              <HashText label={t("public_anchor")} value={rec.anchor.publicTxHash} />
            )}
            {rec.signature && (
              <HashText label={t("signature")} value={rec.signature} />
            )}
            {verifyResult && (
              <Text style={{ fontSize: rs(12), color: verifyResult.ok ? C.good : C.danger, marginTop: rs(8) }}>
                {verifyResult.ok ? "Verified on-chain" : "Verification failed: " + verifyResult.error}
              </Text>
            )}
            <TouchableOpacity
              onPress={onVerify}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t("verify_receipt")}
              style={{ marginTop: rs(10) }}
            >
              <Text style={{ fontSize: rs(13), color: C.accent }}>{t("verify_receipt")} →</Text>
            </TouchableOpacity>
          </Expandable>
        </Card>
      </ScrollView>
    </View>
  );
}
