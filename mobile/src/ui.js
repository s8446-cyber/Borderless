// Shared UI component library.
// All components use ThemeContext for colours and expose accessibilityRole /
// accessibilityLabel / accessibilityState so VoiceOver and TalkBack work
// correctly out-of-the-box. Touch targets are ≥48 dp in every dimension.

import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Pressable,
} from "react-native";
import { useTheme, useThemedStyles } from "./theme.js";
import { rs } from "./responsive.js";

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

export function Brand({ subtitle }) {
  const C = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: rs(16) }}>
      <Text style={{ fontSize: rs(28), fontWeight: "800", color: C.accent, letterSpacing: 0.5 }} accessibilityRole="header">
        Borderless
      </Text>
      {Boolean(subtitle) && <Text style={{ fontSize: rs(14), color: C.muted, marginTop: rs(4) }}>{subtitle}</Text>}
    </View>
  );
}

export function Card({ children, style, glow }) {
  const C = useTheme();
  return (
    <View style={[{ backgroundColor: C.card, borderRadius: rs(16), padding: rs(16), borderWidth: 1, borderColor: glow ? C.accent + "44" : C.border }, style]}>
      {children}
    </View>
  );
}

export function ScreenHeader({ title, onBack, rightElement }) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: rs(16), paddingVertical: rs(12), borderBottomWidth: 1, borderBottomColor: C.border, minHeight: rs(52) }}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Go back"
          style={{ marginRight: rs(12), padding: rs(4), minWidth: rs(36), minHeight: rs(36), justifyContent: "center" }}>
          <Text style={{ fontSize: rs(22), color: C.accent }}>←</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ width: rs(40) }} />
      )}
      <Text style={{ flex: 1, fontSize: rs(17), fontWeight: "700", color: C.text, textAlign: "center" }} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: rs(40), alignItems: "flex-end" }}>{rightElement || null}</View>
    </View>
  );
}

export function SectionHeader({ title, action, onAction }) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: rs(8), marginTop: rs(16) }}>
      <Text style={{ flex: 1, fontSize: rs(13), fontWeight: "600", color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>{title}</Text>
      {action && onAction && (
        <TouchableOpacity onPress={onAction} hitSlop={HIT} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={{ fontSize: rs(13), color: C.accent }}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function Row({ label, value, accent, big, muted }) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: rs(6) }} accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ fontSize: rs(big ? 15 : 13), color: C.muted, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: rs(big ? 17 : 14), fontWeight: big ? "700" : "500", color: accent ? C.accent : C.text, maxWidth: "60%", textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

export function Pill({ label, color, bg }) {
  const C = useTheme();
  return (
    <View style={{ paddingHorizontal: rs(10), paddingVertical: rs(3), borderRadius: rs(20), backgroundColor: bg || C.card2 }}>
      <Text style={{ fontSize: rs(11), fontWeight: "600", color: color || C.accent }}>{label}</Text>
    </View>
  );
}

export function Badges({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: rs(6) }}>
      {items.map((item, i) => <Pill key={i} label={item.label} color={item.color} bg={item.bg} />)}
    </View>
  );
}

export function Avatar({ initials, size = 48, color }) {
  const C = useTheme();
  const bg = color || C.accent2 + "33";
  const fg = color ? C.text : C.accent2;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }} accessibilityRole="image" accessibilityLabel={`Avatar: ${initials}`}>
      <Text style={{ fontSize: size * 0.38, fontWeight: "700", color: fg }}>{String(initials || "?").slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

export function PrimaryButton({ title, onPress, disabled, secondary, loading, destructive, style }) {
  const C = useTheme();
  const bg = destructive ? C.danger : secondary ? "transparent" : C.accent;
  const fg = secondary ? C.accent : destructive ? "#fff" : C.bg;
  const border = secondary ? C.border : "transparent";
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      hitSlop={HIT}
      style={[{ backgroundColor: bg, borderRadius: rs(12), minHeight: rs(52), justifyContent: "center", alignItems: "center", paddingHorizontal: rs(24), borderWidth: secondary ? 1 : 0, borderColor: border, opacity: disabled ? 0.45 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ fontSize: rs(16), fontWeight: "700", color: fg }}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function Chips({ options, value, onChange }) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: rs(6) }}>
      {(options || []).map((opt) => {
        const selected = opt.value === value || opt.label === value;
        return (
          <TouchableOpacity
            key={opt.value || opt.label}
            onPress={() => onChange && onChange(opt.value || opt.label)}
            hitSlop={HIT}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected }}
            style={{ paddingHorizontal: rs(14), paddingVertical: rs(8), borderRadius: rs(20), backgroundColor: selected ? C.accent : C.card2, borderWidth: 1, borderColor: selected ? C.accent : C.border, minHeight: rs(36), justifyContent: "center" }}
          >
            <Text style={{ fontSize: rs(13), fontWeight: selected ? "700" : "400", color: selected ? C.bg : C.text }}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function PinDots({ filled, total = 4 }) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: rs(16), marginVertical: rs(16) }} accessibilityRole="progressbar" accessibilityLabel={`PIN: ${filled} of ${total} digits entered`} accessibilityValue={{ min: 0, max: total, now: filled }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{ width: rs(14), height: rs(14), borderRadius: rs(7), backgroundColor: i < filled ? C.accent : C.border }} />
      ))}
    </View>
  );
}

const PAD = [["1","2","3"],["4","5","6"],["7","8","9"],[null,"0","del"]];

export function PinPad({ onKey }) {
  const C = useTheme();
  return (
    <View style={{ alignSelf: "center", width: "80%" }}>
      {PAD.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: rs(12) }}>
          {row.map((key, ki) =>
            key === null ? (
              <View key={ki} style={{ flex: 1 }} />
            ) : (
              <TouchableOpacity
                key={ki}
                onPress={() => onKey && onKey(key)}
                hitSlop={HIT}
                accessibilityRole="button"
                accessibilityLabel={key === "del" ? "Delete digit" : key}
                style={{ flex: 1, minHeight: rs(56), marginHorizontal: rs(4), borderRadius: rs(12), backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, justifyContent: "center", alignItems: "center" }}
              >
                <Text style={{ fontSize: rs(key === "del" ? 18 : 22), fontWeight: "600", color: key === "del" ? C.muted : C.text }}>
                  {key === "del" ? "\u232b" : key}
                </Text>
              </TouchableOpacity>
            )
          )}
        </View>
      ))}
    </View>
  );
}

export function Field({ label, value, onChangeText, placeholder, error, keyboardType, secureTextEntry, autoCapitalize, autoCorrect, editable, maxLength, returnKeyType, onSubmitEditing, style, inputRef }) {
  const C = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? C.danger : focused ? C.accent : C.border;
  return (
    <View style={[{ marginBottom: rs(12) }, style]}>
      {Boolean(label) && <Text style={{ fontSize: rs(12), color: C.muted, marginBottom: rs(4), fontWeight: "500" }}>{label}</Text>}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.muted2}
        keyboardType={keyboardType || "default"}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize !== undefined ? autoCapitalize : "none"}
        autoCorrect={autoCorrect !== undefined ? autoCorrect : false}
        editable={editable !== false}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label || placeholder}
        accessibilityHint={error || undefined}
        style={{ backgroundColor: C.surface, borderRadius: rs(10), borderWidth: 1, borderColor, color: C.text, fontSize: rs(15), paddingHorizontal: rs(14), paddingVertical: rs(12), minHeight: rs(48) }}
      />
      {Boolean(error) && <Text style={{ fontSize: rs(12), color: C.danger, marginTop: rs(4) }} accessibilityRole="alert">{error}</Text>}
    </View>
  );
}

export function Expandable({ title, children }) {
  const C = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginTop: rs(8) }}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} hitSlop={HIT} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", paddingVertical: rs(10) }}>
        <Text style={{ flex: 1, fontSize: rs(13), color: C.muted, fontWeight: "500" }}>{title}</Text>
        <Text style={{ fontSize: rs(13), color: C.muted }}>{open ? "\u25b2" : "\u25bc"}</Text>
      </TouchableOpacity>
      {open && <View style={{ paddingTop: rs(4) }}>{children}</View>}
    </View>
  );
}

export function OfflineBanner({ visible }) {
  if (!visible) return null;
  return (
    <View style={{ backgroundColor: "#c47d09", paddingVertical: rs(6), paddingHorizontal: rs(16), flexDirection: "row", alignItems: "center" }} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: "#fff", fontSize: rs(13), fontWeight: "600" }}>⚠️ You're offline — check your connection</Text>
    </View>
  );
}

export function HashText({ value, label }) {
  const C = useTheme();
  return (
    <View style={{ marginVertical: rs(4) }}>
      {Boolean(label) && <Text style={{ fontSize: rs(11), color: C.muted, marginBottom: rs(2) }}>{label}</Text>}
      <Text selectable style={{ fontSize: rs(10), fontFamily: "monospace", color: C.muted2, letterSpacing: 0.5 }} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
    </View>
  );
}
