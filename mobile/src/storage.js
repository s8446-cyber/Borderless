// Platform storage for persistence across app launches.
//
// Two tiers, matching what each kind of data deserves:
//  - SECURE tier (session tokens): OS keystore/keychain via expo-secure-store,
//    hardware-backed on modern devices, never synced to cloud backups.
//  - DOCUMENT tier (demo-mode state): a JSON file in the app's private
//    document directory via expo-file-system (SecureStore has a ~2KB Android
//    value limit; the demo ledger can outgrow it).
//
// On WEB (`npm run sim`):
//  - SECURE tier is in-memory only — real session tokens are never written to
//    localStorage (the PWA is the production web surface; this is a dev sim).
//  - DOCUMENT tier persists to localStorage so a page reload behaves like an
//    app relaunch: a returning demo user lands on the unlock screen with
//    their wallet intact, exactly like the native app. "Sign out" on the lock
//    screen gives you a fresh install.
import { Platform } from "react-native";

const IS_WEB = Platform.OS === "web";
const mem = new Map(); // web fallback

function webStore() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* privacy mode — fall back to memory */
  }
  return null;
}

// ---- secure tier ----
export async function saveSecure(key, value) {
  if (IS_WEB) {
    mem.set("sec:" + key, value);
    return;
  }
  const SecureStore = require("expo-secure-store");
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadSecure(key) {
  if (IS_WEB) return mem.get("sec:" + key) || null;
  const SecureStore = require("expo-secure-store");
  return (await SecureStore.getItemAsync(key)) || null;
}

export async function deleteSecure(key) {
  if (IS_WEB) {
    mem.delete("sec:" + key);
    return;
  }
  const SecureStore = require("expo-secure-store");
  await SecureStore.deleteItemAsync(key).catch(() => {});
}

// ---- document tier ----
function docPath(name) {
  const FileSystem = require("expo-file-system");
  return FileSystem.documentDirectory + name;
}

export async function saveDoc(name, contents) {
  if (IS_WEB) {
    const ls = webStore();
    if (ls) {
      try {
        ls.setItem("bp:doc:" + name, contents);
        return;
      } catch {
        /* quota — fall back to memory */
      }
    }
    mem.set("doc:" + name, contents);
    return;
  }
  const FileSystem = require("expo-file-system");
  await FileSystem.writeAsStringAsync(docPath(name), contents);
}

export async function loadDoc(name) {
  if (IS_WEB) {
    const ls = webStore();
    if (ls) {
      try {
        const v = ls.getItem("bp:doc:" + name);
        if (v !== null) return v;
      } catch {
        /* fall through to memory */
      }
    }
    return mem.get("doc:" + name) || null;
  }
  try {
    const FileSystem = require("expo-file-system");
    return await FileSystem.readAsStringAsync(docPath(name));
  } catch {
    return null; // missing file = first run
  }
}

export async function deleteDoc(name) {
  if (IS_WEB) {
    const ls = webStore();
    if (ls) {
      try {
        ls.removeItem("bp:doc:" + name);
      } catch {
        /* ignore */
      }
    }
    mem.delete("doc:" + name);
    return;
  }
  try {
    const FileSystem = require("expo-file-system");
    await FileSystem.deleteAsync(docPath(name), { idempotent: true });
  } catch {
    /* already gone */
  }
}
