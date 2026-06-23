// Shared native UI primitives.
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { C } from "./theme";

export function Brand() {
  return (
    <View style={u.brand}>
      <View style={u.logo}>
        <Text style={[{ fontSize: 22 }]}>🌍</Text>
      </View>
      <Text style={u.brandTxt}>Borderless Pay</Text>
    </View>
  );
}

export function Card({ children, style }) {
  return <View style={[u.card, style]}>{children}</View>;
}

export function Row({ label, value, accent, big }) {
  return (
    <View style={[u.row, big && u.rowTotal]}>
      <Text style={[u.rowLbl, big && { fontSize: 17, color: C.text }]}>{label}</Text>
      <Text style={[u.rowVal, big && { fontSize: 19 }, accent && { color: C.accent }]}>{value}</Text>
    </View>
  );
}

export function Pill({ children }) {
  return (
    <View style={u.pill}>
      <Text style={u.pillTxt}>{children}</Text>
    </View>
  );
}

export function Badges({ items }) {
  return (
    <View style={u.badges}>
      {items.map((b, i) => (
        <View key={i} style={u.badge}>
          <Text style={u.badgeTxt}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

export function PrimaryButton({ title, onPress, disabled, secondary, loading }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[u.btn, secondary && u.btnSecondary, (disabled || loading) && { opacity: 0.5 }]}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? C.text : "#04122b"} />
      ) : (
        <Text style={[u.btnTxt, secondary && { color: C.text }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Chips({ options, value, onChange }) {
  return (
    <View style={u.chips}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[u.chip, active && u.chipActive]}
          >
            <Text style={[u.chipTxt, active && { color: "#04122b", fontWeight: "700" }]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function PinDots({ filled, total = 4 }) {
  return (
    <View style={u.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[u.dot, i < filled && u.dotFilled]} />
      ))}
    </View>
  );
}

export function PinPad({ onKey }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", ""];
  return (
    <View style={u.pad}>
      {keys.map((k, i) =>
        k === "" ? (
          <View key={i} style={u.key} />
        ) : (
          <TouchableOpacity key={i} style={u.key} activeOpacity={0.7} onPress={() => onKey(k)}>
            <Text style={u.keyTxt}>{k === "del" ? "⌫" : k}</Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

const u = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 22 },
  logo: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  brandTxt: { color: C.text, fontSize: 20, fontWeight: "700" },
  card: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  rowTotal: { borderTopWidth: 1, borderTopColor: "#33406b", marginTop: 6, paddingTop: 14 },
  rowLbl: { color: C.muted, fontSize: 15 },
  rowVal: { color: C.text, fontSize: 15, fontWeight: "600" },
  pill: { alignSelf: "flex-start", backgroundColor: "#173a2e", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  pillTxt: { color: C.accent, fontSize: 12, fontWeight: "700" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  badge: { backgroundColor: "#11233f", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  badgeTxt: { color: C.accent2, fontSize: 11 },
  btn: { backgroundColor: C.accent, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 10 },
  btnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#33406b" },
  btnTxt: { color: "#04122b", fontSize: 16, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { backgroundColor: C.card2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipTxt: { color: C.text, fontSize: 13 },
  dots: { flexDirection: "row", gap: 14, justifyContent: "center", marginVertical: 18 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: "#33406b" },
  dotFilled: { backgroundColor: C.accent, borderColor: C.accent },
  pad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10 },
  key: { width: "31%", backgroundColor: C.card2, borderRadius: 14, paddingVertical: 18, alignItems: "center", marginBottom: 12 },
  keyTxt: { color: C.text, fontSize: 24, fontWeight: "600" },
});
