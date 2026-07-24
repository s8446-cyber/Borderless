// Activity screen with FlatList (virtualized), search, filter chips,
// CSV export, and per-transaction detail screen.
import React, { useState, useMemo } from "react";
import { View, Text, FlatList, TouchableOpacity, Share } from "react-native";
import { useApp } from "./context.js";
import { ScreenHeader, Card, Field, Chips, SectionHeader } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { fmtINR } from "../format.js";
import { filterPayments, buildActivityCsv, displayName, ACTIVITY_FILTERS } from "../activity.js";

export function ActivityScreen() {
  const C = useTheme();
  const { history, setScreen, openTxnDetail } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const visible = useMemo(
    () => filterPayments(history || [], { query, filter }),
    [history, query, filter]
  );

  const onExport = async () => {
    const csv = buildActivityCsv(visible);
    const filename = `borderless-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      await Share.share({ message: csv, title: filename });
    } catch { /* dismissed */ }
  };

  const CHIP_OPTIONS = ACTIVITY_FILTERS.map((f) => ({
    value: f,
    label: t(`filter_${f}`),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader
        title={t("activity")}
        onBack={() => setScreen && setScreen("home")}
        rightElement={
          <TouchableOpacity
            onPress={onExport}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t("export_csv")}
          >
            <Text style={{ fontSize: rs(13), color: C.accent }}>{t("export_csv")}</Text>
          </TouchableOpacity>
        }
      />

      {/* Search */}
      <View style={{ paddingHorizontal: rs(16), paddingTop: rs(12) }}>
        <Field
          placeholder={t("search_activity")}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        <Chips options={CHIP_OPTIONS} value={filter} onChange={setFilter} />
      </View>

      {visible.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: C.muted, fontSize: rs(15) }}>{t("no_activity")}</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(p) => p.paymentId}
          contentContainerStyle={{ padding: rs(16) }}
          renderItem={({ item: p }) => (
            <TouchableOpacity
              onPress={() => openTxnDetail && openTxnDetail(p)}
              accessibilityRole="button"
              accessibilityLabel={`${displayName(p)}, ${fmtINR(p.total)}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: rs(14),
                borderBottomWidth: 1,
                borderBottomColor: C.line,
                minHeight: rs(56),
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: rs(15), color: C.text, fontWeight: "600" }}>{displayName(p)}</Text>
                <Text style={{ fontSize: rs(12), color: C.muted, marginTop: rs(2) }}>
                  {p.kind} · {p.currency || "INR"} · {p.reference || ""}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: rs(16), fontWeight: "700", color: C.text }}>−{fmtINR(p.total)}</Text>
                <Text style={{ fontSize: rs(11), color: C.muted }}>{p.status || "completed"}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

export function TxnDetailScreen() {
  const C = useTheme();
  const { selectedTxn, setScreen, receipt } = useApp();
  const p = selectedTxn || receipt;
  if (!p) return null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader title={t("txn_detail")} onBack={() => setScreen && setScreen("history")} />
      <View style={{ padding: rs(16) }}>
        <Card>
          <Text style={{ fontSize: rs(20), fontWeight: "700", color: C.text, marginBottom: rs(12) }}>
            {displayName(p)}
          </Text>
          <View style={{ height: 1, backgroundColor: C.line, marginBottom: rs(12) }} />
          <Text style={{ fontSize: rs(24), fontWeight: "800", color: C.accent, marginBottom: rs(16) }}>
            −{fmtINR(p.total)}
          </Text>
          {p.reference && <Text style={{ fontSize: rs(12), color: C.muted }}>Ref: {p.reference}</Text>}
          {p.kind && <Text style={{ fontSize: rs(12), color: C.muted }}>Type: {p.kind}</Text>}
          {p.currency && <Text style={{ fontSize: rs(12), color: C.muted }}>Currency: {p.currency}</Text>}
          {p.status && <Text style={{ fontSize: rs(12), color: C.muted }}>Status: {p.status}</Text>}
        </Card>
      </View>
    </View>
  );
}
