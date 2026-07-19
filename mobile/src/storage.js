// Platform storage for persistence across app launches.
//
// SECURE tier (session tokens): OS keystore/keychain via expo-secure-store,
// hardware-backed on modern devices, never synced to cloud backups.
//
// On WEB (`npm run sim`): in-memory only — session tokens are never written
// to localStorage (the PWA is the production web surface; this is a dev sim).
import { Platform } from "react-native";

const IS_WEB = Platform.OS === "web";
const mem = new Map(); // web fallback

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
