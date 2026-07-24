// Help / dispute / report-fraud screen.
// POSTs to /api/disputes with a description and optional paymentId.
// Also hosts "Privacy & your data" — self-serve DPDP rights:
//   • data export  (POST /api/account/export)  shared via the OS share sheet
//   • correction   (POST /api/account/profile) for name / country
// Both re-ask the current password (reauthentication) on top of the session.
import React, { useState } from "react";
import { View, Text, ScrollView, Share } from "react-native";
import { useApp } from "./context.js";
import { ScreenHeader, Card, Field, PrimaryButton } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { api } from "../api.js";
import { humanError } from "../errors.js";
import { buildExportShareText } from "../dsr.js";

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

  // Privacy & your data (DSR) state — one shared password field.
  const [pw, setPw] = useState("");
  const [newName, setNewName] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [privErr, setPrivErr] = useState("");
  const [privMsg, setPrivMsg] = useState("");
  const [busyExport, setBusyExport] = useState(false);
  const [busyCorrect, setBusyCorrect] = useState(false);

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

  const onExport = async () => {
    if (!pw) { setPrivErr("Enter your current password."); return; }
    setPrivErr(""); setPrivMsg(""); setBusyExport(true);
    try {
      const data = await api("/api/account/export", { method: "POST", body: { password: pw } });
      await Share.share({ title: "Borderless Pay data export", message: buildExportShareText(data) });
      setPrivMsg("Export ready \u2014 save it somewhere safe.");
    } catch (e) {
      setPrivErr(humanError(e));
    } finally {
      setBusyExport(false);
    }
  };

  const onCorrect = async () => {
    if (!pw) { setPrivErr("Enter your current password."); return; }
    if (!newName.trim() && !newCountry.trim()) { setPrivErr("Enter a new name and/or country."); return; }
    setPrivErr(""); setPrivMsg(""); setBusyCorrect(true);
    try {
      const body = { password: pw };
      if (newName.trim()) body.fullName = newName.trim();
      if (newCountry.trim()) body.country = newCountry.trim();
      const r = await api("/api/account/profile", { method: "POST", body });
      setPrivMsg(
        r.updated && r.updated.length
          ? "Updated " + r.updated.join(" and ") + (r.kyc ? " \u2014 KYC re-checked: " + r.kyc.status : "")
          : "Nothing changed \u2014 details already match."
      );
      setNewName(""); setNewCountry("");
    } catch (e) {
      setPrivErr(humanError(e));
    } finally {
      setBusyCorrect(false);
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

            {/* Privacy & your data — self-serve DPDP rights. */}
            <Text style={{ fontSize: rs(18), fontWeight: "700", color: C.text, marginTop: rs(28), marginBottom: rs(8) }}>
              Privacy & your data
            </Text>
            <Card style={{ marginBottom: rs(12) }}>
              <Text style={{ fontSize: rs(13), color: C.muted, marginBottom: rs(10) }}>
                Download everything we hold about you, or correct your name or country.
                Your current password is required — a device alone is never enough.
              </Text>
              <Field
                label="Current password"
                value={pw}
                onChangeText={setPw}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              {Boolean(privErr) && (
                <Text style={{ color: C.danger, marginBottom: rs(8) }} accessibilityRole="alert">{privErr}</Text>
              )}
              {Boolean(privMsg) && (
                <Text style={{ color: C.good, marginBottom: rs(8) }}>{privMsg}</Text>
              )}
              <PrimaryButton title="Download my data" onPress={onExport} loading={busyExport} secondary />
              <View style={{ height: rs(16) }} />
              <Text style={{ fontSize: rs(13), color: C.muted, marginBottom: rs(6) }}>
                Correct your details (leave a field blank to keep it):
              </Text>
              <Field label="Full name" value={newName} onChangeText={setNewName} autoCapitalize="words" />
              <Field label="Country" value={newCountry} onChangeText={setNewCountry} autoCapitalize="none" maxLength={60} />
              <PrimaryButton title="Update my details" onPress={onCorrect} loading={busyCorrect} secondary />
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
