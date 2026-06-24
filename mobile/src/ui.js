// Shared native UI primitives — elevated, with subtle press micro-interactions
// built on React Native's core Animated API (no extra native dependencies).
import React, { useRef } from "react";
import { View, Text, TouchableOpacity, Pressable, Animated, StyleSheet, ActivityIndicator } from "react-native";
import { C } from "./theme";

export function Brand({ subtitle }) {
  return (
    <View style={u.brandRow}>
      <View style={u.logo}>
        <Text style={[{ fontSize: 22 }]}>🌍</Text>
      </View>
      <View>
        <Text style={u.brandTxt}>Borderless Pay</Text>
        {subtitle ? <Text style={u.brandSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function Card({ children, style, glow }) {
  return <View style={[u.card, glow && u.cardGlow, style]}>{children}</View>;
}

export function SectionHeader({ title, action, onAction }) {
  return (
    <View style={u.sectionRow}>
      <Text style={u.sectionTitle}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text style={u.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function Row({ label, value, accent, big }) {
  return (
    <View style={[u.row, big && u.rowTotal]}>
      <Text style={[u.rowLbl, big && { fontSize: 16, color: C.text }]}>{label}</Text>
      <Text
        style={[
          u.rowVal,
          big && { fontSize: 20, fontWeight: "800" },
          accent && { color: C.accent },
        ]}
      >
        {value}
      </Text>
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

export function Avatar({ initials, size = 50 }) {
  return (
    <View style={[u.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[{ color: "#04122b", fontWeight: "800", fontSize: size * 0.34 }]}>{initials}</Text>
    </View>
  );
}

// Primary button with a spring press-scale for a tactile, premium feel.
export function PrimaryButton({ title, onPress, disabled, secondary, loading }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      disabled={disabled || loading}
    >
      <Animated.View
        style={[
          u.btn,
          secondary && u.btnSecondary,
          (disabled || loading) && { opacity: 0.5 },
          { transform: [{ scale }] },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={secondary ? C.text : "#04122b"} />
        ) : (
          <Text style={[u.btnTxt, secondary && { color: C.text }]}>{title}</Text>
        )}
      </Animated.View>
    </Pressable>
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
            activeOpacity={0.8}
            style={[u.chip, active && u.chipActive]}
          >
            <Text style={[u.chipTxt, active && { color: "#04122b", fontWeight: "800" }]}>{o.label}</Text>
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
          <TouchableOpacity key={i} style={u.key} activeOpacity={0.6} onPress={() => onKey(k)}>
            <Text style={u.keyTxt}>{k === "del" ? "⌫" : k}</Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

const u = StyleSheet.create({
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 22 },
  logo: {
    width: 42, height: 42, borderRadius: 13, backgroundColor: C.accent,
    alignItems: "center", justifyContent: "center",
    shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  brandTxt: { color: C.text, fontSize: 19, fontWeight: "800", letterSpacing: 0.2 },
  brandSub: { color: C.muted, fontSize: 12, marginTop: 1 },
  card: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 14,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 4,
  },
  cardGlow: { borderColor: C.accent, shadowColor: C.accent, shadowOpacity: 0.25 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 12 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: "800", letterSpacing: 0.2 },
  sectionAction: { color: C.accent, fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9 },
  rowTotal: { borderTopWidth: 1, borderTopColor: "#2b3a6b", marginTop: 6, paddingTop: 14 },
  rowLbl: { color: C.muted, fontSize: 15 },
  rowVal: { color: C.text, fontSize: 15, fontWeight: "600" },
  pill: { alignSelf: "flex-start", backgroundColor: "#143a2e", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  pillTxt: { color: C.accent, fontSize: 12, fontWeight: "700" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  badge: { backgroundColor: "#11233f", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9 },
  badgeTxt: { color: C.accent2, fontSize: 11, fontWeight: "600" },
  avatar: { backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  btn: {
    backgroundColor: C.accent, borderRadius: 15, padding: 16, alignItems: "center", marginTop: 10,
    shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
  btnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#33406b", shadowOpacity: 0, elevation: 0 },
  btnTxt: { color: "#04122b", fontSize: 16, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { backgroundColor: C.card2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipTxt: { color: C.text, fontSize: 13, fontWeight: "600" },
  dots: { flexDirection: "row", gap: 16, justifyContent: "center", marginVertical: 20 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: "#33406b" },
  dotFilled: { backgroundColor: C.accent, borderColor: C.accent },
  pad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10 },
  key: { width: "31%", backgroundColor: C.card2, borderRadius: 16, paddingVertical: 18, alignItems: "center", marginBottom: 12 },
  keyTxt: { color: C.text, fontSize: 24, fontWeight: "600" },
});
