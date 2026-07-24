// Home screen — balance card + action grid + quick-access to activity.
import React from "react";
import { View, Text, ScrollView, TouchableOpacity, FlatList } from "react-native";
import { useApp } from "./context.js";
import { Card, SectionHeader, Row, PrimaryButton } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { fmtINR } from "../format.js";
import { Icon } from "../icons.js";
import { displayName } from "../activity.js";

const ACTIONS = [
  { key: "pay",     icon: "scan",     labelKey: "scan",           handler: "startScan" },
  { key: "send",    icon: "send",     labelKey: "send",           handler: "startSend" },
  { key: "scanDom", icon: "pay",      labelKey: "pay",            handler: "startScanDomestic" },
  { key: "recharge",icon: "recharge", labelKey: "mobile_recharge",handler: "startDomRecharge" },
  { key: "bills",   icon: "bills",    labelKey: "pay_bills",      handler: "startDomBill" },
  { key: "contacts",icon: "contacts", labelKey: "contacts",       handler: "openContacts" },
  { key: "add",     icon: "add",      labelKey: "add_money",      handler: "openAddMoney" },
  { key: "help",    icon: "help",     labelKey: "help",           handler: "openHelp" },
];

export function HomeScreen() {
  const C = useTheme();
  const app = useApp();
  const { meta, history, setScreen, name } = app;

  const balance = meta ? meta.balance : 0;
  const savings = meta ? meta.savingsRate : null;
  const shortfall = meta ? meta.shortfall : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: rs(16) }}>
      {/* Greeting */}
      <Text style={{ fontSize: rs(20), fontWeight: "700", color: C.text, marginBottom: rs(4) }}
        accessibilityRole="header">
        Hey, {name || "there"}
      </Text>

      {/* Balance card */}
      <Card glow style={{ marginBottom: rs(16) }}>
        <Text style={{ fontSize: rs(12), color: C.muted, marginBottom: rs(4) }}>{t("balance")}</Text>
        <Text
          style={{ fontSize: rs(36), fontWeight: "800", color: C.accent }}
          accessibilityLabel={`Balance: ${fmtINR(balance)}`}
        >
          {fmtINR(balance)}
        </Text>
        {savings && (
          <Text style={{ fontSize: rs(12), color: C.good, marginTop: rs(4) }}>
            {t("savings", { rate: savings })}
          </Text>
        )}
        {shortfall && (
          <Text style={{ fontSize: rs(12), color: C.warn, marginTop: rs(4) }}>
            {t("shortfall", { amount: fmtINR(shortfall) })}
          </Text>
        )}
      </Card>

      {/* Action grid */}
      <SectionHeader title="Quick actions" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: rs(10), marginBottom: rs(16) }}>
        {ACTIONS.map((a) => {
          const handler = app[a.handler] || (() => setScreen && setScreen(a.key));
          return (
            <TouchableOpacity
              key={a.key}
              onPress={handler}
              accessibilityRole="button"
              accessibilityLabel={t(a.labelKey)}
              style={{
                width: "22%",
                aspectRatio: 1,
                backgroundColor: C.card2,
                borderRadius: rs(14),
                borderWidth: 1,
                borderColor: C.border,
                alignItems: "center",
                justifyContent: "center",
                minHeight: rs(64),
              }}
            >
              <Icon name={a.icon} size={rs(24)} color={C.accent} />
              <Text style={{ fontSize: rs(10), color: C.muted, marginTop: rs(4), textAlign: "center" }}>
                {t(a.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Recent activity (last 5) */}
      {history && history.length > 0 && (
        <>
          <SectionHeader
            title={t("activity")}
            action="See all"
            onAction={() => setScreen && setScreen("history")}
          />
          {history.slice(0, 5).map((p) => (
            <TouchableOpacity
              key={p.paymentId}
              onPress={() => app.openTxnDetail && app.openTxnDetail(p)}
              accessibilityRole="button"
              accessibilityLabel={`${displayName(p)}, ${fmtINR(p.total)}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: rs(10),
                borderBottomWidth: 1,
                borderBottomColor: C.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: rs(14), color: C.text, fontWeight: "500" }}>{displayName(p)}</Text>
                <Text style={{ fontSize: rs(11), color: C.muted }}>{p.kind} · {p.currency || "INR"}</Text>
              </View>
              <Text style={{ fontSize: rs(15), fontWeight: "700", color: C.text }}>−{fmtINR(p.total)}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );
}
