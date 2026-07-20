// Cross-platform alerts + a simulated native-OS layer for the browser build.
//
// WHY THIS EXISTS
// On a real device the OS provides all of this: React Native's `Alert`, the
// biometric sheet (expo-local-authentication), and the in-context permission
// prompts (camera / contacts / notifications). In a browser, `react-native-web`
// ships `Alert` as a literal no-op (`static alert() {}`), and there are no OS
// permission or biometric prompts at all. That silently breaks a large part of
// the app when it runs via `npm run sim`: error toasts, the consent warning,
// wrong-PIN feedback, the Verify-ledger result, and — worst of all — the
// Log out / Close account confirmations (their button callbacks never fire).
//
// This module gives the web simulation faithful, on-screen equivalents so the
// ENTIRE app is demonstrable and testable in a browser, while native devices
// keep using the real OS dialogs untouched.
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Alert as RNAlert, Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { C } from "./theme";

const IS_WEB = Platform.OS === "web";

// A tiny channel between the imperative API and the mounted <AlertHost/>.
let enqueue = null;
const buffer = [];
function push(item) {
  if (enqueue) enqueue(item);
  else buffer.push(item); // host not mounted yet — buffer until it is
}

function normalizeButtons(buttons) {
  return buttons && buttons.length ? buttons : [{ text: "OK" }];
}

// Drop-in replacement for `Alert.alert(title, message, buttons)`.
// Native → the real OS alert. Web → the in-app modal below.
export function appAlert(title, message, buttons) {
  if (!IS_WEB) return RNAlert.alert(title, message, buttons);
  push({ kind: "alert", title, message, buttons: normalizeButtons(buttons) });
}

// Web-only: an OS-style permission sheet. Resolves `true` when allowed.
// On native, callers use the real expo permission APIs instead.
function simulateOSPrompt({ icon = "🔐", title, message, allowText = "Allow", denyText = "Don't Allow" }) {
  return new Promise((resolve) => {
    push({
      kind: "os",
      icon,
      title,
      message,
      buttons: [
        { text: denyText, style: "cancel", onPress: () => resolve(false) },
        { text: allowText, onPress: () => resolve(true) },
      ],
    });
  });
}

// Web-only: simulated permission STATE. A real OS remembers Allow/Deny and
// never re-asks; the sim mirrors that for the session (a page reload is a
// "fresh install"). Keeps the in-context, ask-once, never-nag behavior honest.
const simPermState = {}; // name -> "granted" | "denied"

export function getSimPerm(name) {
  return simPermState[name] || "undetermined";
}

// Ask once, remember the answer. Returns true when granted (now or earlier).
export async function requestSimPerm(name, promptOpts) {
  if (simPermState[name] === "granted") return true;
  if (simPermState[name] === "denied") return false;
  const ok = await simulateOSPrompt(promptOpts);
  simPermState[name] = ok ? "granted" : "denied";
  return ok;
}

// Web-only: a biometric (Face ID / fingerprint) sheet. Resolves in the same
// shape as expo-local-authentication's `authenticateAsync` ({ success }).
export function simulateBiometric(promptMessage = "Authorize your payment") {
  return new Promise((resolve) => {
    push({
      kind: "bio",
      icon: "👤",
      title: "Face ID",
      message: promptMessage,
      buttons: [
        { text: "Cancel", style: "cancel", onPress: () => resolve({ success: false }) },
        { text: "Authenticate", onPress: () => resolve({ success: true }) },
      ],
    });
  });
}

// Mounted once near the app root. Renders queued items one at a time. On native
// it renders nothing (the OS draws real dialogs).
export function AlertHost() {
  const [queue, setQueue] = useState([]);
  const add = useCallback((item) => setQueue((q) => [...q, item]), []);

  useEffect(() => {
    if (!IS_WEB) return;
    enqueue = add;
    if (buffer.length) {
      buffer.forEach(add);
      buffer.length = 0;
    }
    return () => {
      enqueue = null;
    };
  }, [add]);

  if (!IS_WEB) return null;
  const current = queue[0];
  if (!current) return null;

  const dismiss = (btn) => {
    setQueue((q) => q.slice(1));
    if (btn && typeof btn.onPress === "function") btn.onPress();
  };
  const cancelBtn = current.buttons.find((b) => b.style === "cancel") || current.buttons[0];
  const stack = current.buttons.length > 2;
  const isOS = current.kind === "os" || current.kind === "bio";

  return (
    <Modal transparent animationType="none" visible onRequestClose={() => dismiss(cancelBtn)}>
      <View style={a.backdrop}>
        <View style={a.sheet}>
          {current.icon ? <Text style={a.icon}>{current.icon}</Text> : null}
          {isOS ? (
            <Text style={a.tag}>{current.kind === "bio" ? "Device authentication" : "System permission"} · simulated in browser</Text>
          ) : null}
          {current.title ? <Text style={a.title}>{current.title}</Text> : null}
          {current.message ? <Text style={a.message}>{current.message}</Text> : null}
          <View style={[a.buttons, stack && a.buttonsStacked]}>
            {current.buttons.map((b, i) => (
              <Pressable
                key={i}
                onPress={() => dismiss(b)}
                style={({ pressed }) => [
                  a.btn,
                  b.style === "cancel" && a.btnCancelBox,
                  b.style === "destructive" && a.btnDestructiveBox,
                  stack && a.btnStacked,
                  pressed && a.btnPressed,
                ]}
              >
                <Text
                  style={[
                    a.btnTxt,
                    b.style === "cancel" && a.btnCancel,
                    b.style === "destructive" && a.btnDestructive,
                  ]}
                >
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const a = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(4,8,20,0.72)", alignItems: "center", justifyContent: "center", padding: 26 },
  sheet: {
    width: "100%", maxWidth: 360, backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border,
    padding: 22, alignItems: "center",
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 18 }, elevation: 12,
  },
  icon: { fontSize: 44, marginBottom: 8, textAlign: "center" },
  tag: { color: C.accent2, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8, textAlign: "center" },
  title: { color: C.text, fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  message: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 18 },
  buttons: { flexDirection: "row", gap: 10, alignSelf: "stretch", justifyContent: "center" },
  buttonsStacked: { flexDirection: "column" },
  btn: { flex: 1, backgroundColor: C.accent, borderRadius: 13, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  btnStacked: { flex: 0, alignSelf: "stretch" },
  btnPressed: { opacity: 0.75 },
  btnCancelBox: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#33406b" },
  btnDestructiveBox: { backgroundColor: C.danger },
  btnTxt: { color: "#04122b", fontSize: 15, fontWeight: "800" },
  btnCancel: { color: C.text },
  btnDestructive: { color: "#fff" },
});
