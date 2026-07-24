// Contacts screen — send to saved contacts or phone-book contacts.
import React, { useState } from "react";
import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { useApp } from "./context.js";
import { ScreenHeader, Field, Avatar } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";

export function ContactsScreen() {
  const C = useTheme();
  const { contacts, setScreen, payContact, loadPhoneContacts, phoneContacts, payPhoneContact } = useApp();
  const [query, setQuery] = useState("");

  const filtered = (contacts || []).filter((c) =>
    !query || (c.name || "").toLowerCase().includes(query.toLowerCase()) ||
    (c.vpa || "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader title={t("contacts")} onBack={() => setScreen && setScreen("home")} />
      <View style={{ padding: rs(16) }}>
        <Field
          placeholder="Search contacts"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(c, i) => c.id || c.vpa || String(i)}
        contentContainerStyle={{ paddingHorizontal: rs(16) }}
        renderItem={({ item: c }) => (
          <TouchableOpacity
            onPress={() => payContact && payContact(c)}
            accessibilityRole="button"
            accessibilityLabel={`Pay ${c.name}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: rs(12),
              borderBottomWidth: 1,
              borderBottomColor: C.line,
              minHeight: rs(56),
            }}
          >
            <Avatar initials={(c.name || "?")[0]} size={rs(40)} />
            <View style={{ flex: 1, marginLeft: rs(12) }}>
              <Text style={{ fontSize: rs(15), color: C.text, fontWeight: "600" }}>{c.name}</Text>
              <Text style={{ fontSize: rs(12), color: C.muted }}>{c.vpa || c.phone || ""}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ color: C.muted, textAlign: "center", marginTop: rs(32) }}>No contacts yet.</Text>
        }
      />
    </View>
  );
}
