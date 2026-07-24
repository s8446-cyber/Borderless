// Icon wrapper around @expo/vector-icons Ionicons (ships with expo ~51;
// no additional npm install required). Replaces emoji icons throughout
// the app with consistent, platform-adaptive vector glyphs.
//
// Usage:
//   import { Icon } from './src/icons';
//   <Icon name="home" size={24} color={C.text} />
//
// The `name` prop accepts friendly short names mapped to Ionicons identifiers
// here; the mapping lets callers stay decoupled from the underlying library.

import React from "react";
import { Ionicons } from "@expo/vector-icons";

const MAP = {
  // Navigation / tab bar
  home: "home-outline",
  scan: "qr-code-outline",
  activity: "time-outline",
  // Actions
  send: "paper-plane-outline",
  pay: "card-outline",
  add: "add-circle-outline",
  recharge: "phone-portrait-outline",
  bills: "receipt-outline",
  contacts: "people-outline",
  help: "help-circle-outline",
  dispute: "flag-outline",
  fraud: "shield-outline",
  share: "share-social-outline",
  copy: "copy-outline",
  verify: "checkmark-shield-outline",
  export: "download-outline",
  search: "search-outline",
  filter: "filter-outline",
  close: "close-outline",
  back: "arrow-back-outline",
  chevron_right: "chevron-forward-outline",
  chevron_down: "chevron-down-outline",
  // States / indicators
  check: "checkmark-circle-outline",
  check_filled: "checkmark-circle",
  error: "alert-circle-outline",
  info: "information-circle-outline",
  offline: "cloud-offline-outline",
  clock: "time-outline",
  lock: "lock-closed-outline",
  unlock: "lock-open-outline",
  // Payments
  wallet: "wallet-outline",
  bank: "business-outline",
  exchange: "swap-horizontal-outline",
  receipt: "document-text-outline",
  ledger: "layers-outline",
  // People
  person: "person-circle-outline",
  person_add: "person-add-outline",
  // Misc
  settings: "settings-outline",
  logout: "log-out-outline",
  pin: "keypad-outline",
  delete: "backspace-outline",
  eye: "eye-outline",
  eye_off: "eye-off-outline",
  camera: "camera-outline",
  flash: "flash-outline",
  flash_off: "flash-off-outline",
  savings: "trending-up-outline",
};

export function Icon({ name, size = 24, color, style, accessibilityLabel }) {
  const ionName = MAP[name] || name;
  return React.createElement(Ionicons, {
    name: ionName,
    size: size,
    color: color,
    style: style,
    accessibilityLabel: accessibilityLabel,
    accessible: Boolean(accessibilityLabel),
  });
}
