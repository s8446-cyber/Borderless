// Stable per-install device identifier for server-side device binding (G-3/G-6).
// Stored in the OS keystore/keychain via expo-secure-store (hardware-backed on
// modern devices, never synced to cloud backups with THIS_DEVICE_ONLY). The
// server only ever sees/stores a SHA-256 of this value.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "bp_device_id";
let _cached = null;

function randomId() {
  // identifier, not a secret: server-side binding hashes it and pairs it with
  // the bearer token, so unpredictability requirements are modest
  let s = "app-";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export async function getDeviceId() {
  if (_cached) return _cached;
  try {
    if (Platform.OS === "web") throw new Error("SecureStore unavailable on web");
    let id = await SecureStore.getItemAsync(KEY);
    if (!id) {
      id = randomId();
      await SecureStore.setItemAsync(KEY, id, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
    _cached = id;
  } catch {
    _cached = randomId(); // ephemeral fallback (web / keystore failure)
  }
  return _cached;
}
