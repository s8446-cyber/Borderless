// Help / dispute / report-fraud screen.
// POSTs to /api/disputes with a description and optional paymentId.
import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { useApp } from "./context.js";
import { ScreenHeader, Card, Field, PrimaryButton } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { api } from "../api.js";
import { humanError } from "../errors.js";

const ISSUE_TYPES = [
  { key: "general",   label: "General question" },
  { key: "dispute",   label: t("dispute") },
  { key: "fraud",     label: t("report_fraud") },
];

export function HelpScreen() {
  const C = useTheme();
  const { setScreen, receipt, selectedTxn, helpFrom } = useApp();
  const txn = selectedTxn || receipt;
  const [issueType, setIssueType] = useState("general");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async () => {
    if (!description.trim()) { setErr("Please describe the issue."); return; }
    setErr(""); setBusy(true);
    try {
      await api("/api/disputes", {
        method: "POST",
        body: {
          type: issueType,
          description: description.trim(),
          paymentId: txn ? txn.paymentId : undefined,
          reference: txn ? txn.reference : undefined,
        },
      });
      setSent(true);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader
        title={t("help")}
        onBack={() => setScreen && setScreen(helpFrom || "home")}
      />
      <ScrollView contentContainerStyle={{ padding: rs(16) }}>
        {sent ? (
          <Card>
            <Text style={{ fontSize: rs(17), fontWeight: "700", color: C.good, marginBottom: rs(8) }}>
              Request submitted
            </Text>
            <Text style={{ fontSize: rs(14), color: C.muted }}>
              Our team will respond within 24 hours. We'll notify you via email.
            </Text>
            <PrimaryButton title="Back to home" onPress={() => setScreen && setScreen("home")} style={{ marginTop: rs(24) }} />
          </Card>
        ) : (
          <>
            <Text style={{ fontSize: rs(18), fontWeight: "700", color: C.text, marginBottom: rs(16) }}>
              {t("help_title")}
            </Text>

            {txn && (
              <Card style={{ marginBottom: rs(12) }}>
                <Text style={{ fontSize: rs(12), color: C.muted }}>Payment</Text>
                <Text style={{ fontSize: rs(15), color: C.text, fontWeight: "600" }}>
                  {txn.reference || txn.paymentId}
                </Text>
              </Card>
            )}

            {/* Issue type */}
            <View style={{ flexDirection: "row", gap: rs(8), marginBottom: rs(16), flexWrap: "wrap" }}>
              {ISSUE_TYPES.map((it) => (
                <PrimaryButton
                  key={it.key}
                  title={it.label}
                  onPress={() => setIssueType(it.key)}
                  secondary={issueType !== it.key}
                  destructive={it.key === "fraud" && issueType === "fraud"}
                  style={{ flex: 1, minWidth: rs(100) }}
                />
              ))}
            </View>

            <Field
              label={t("describe_issue")}
              value={description}
              onChangeText={setDescription}
              autoCapitalize="sentences"
              autoCorrect
            />

            {Boolean(err) && (
              <Text style={{ color: C.danger, marginBottom: rs(8) }} accessibilityRole="alert">{err}</Text>
            )}

            <PrimaryButton title={t("submit")} onPress={onSubmit} loading={busy} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
