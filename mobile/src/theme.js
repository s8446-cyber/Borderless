// ─── Colour tokens ──────────────────────────────────────────────
const DARK = {
  bg: "#0b1020",
  bg2: "#070b16",
  card: "#121a33",
  card2: "#1a2547",
  surface: "#0f1733",
  elev: "#16203f",
  accent: "#3ddc97",
  accent2: "#5b8cff",
  violet: "#8b5cf6",
  text: "#eaf0ff",
  muted: "#8b97b8",
  muted2: "#6b7aa3",
  good: "#34d399",
  warn: "#f59e0b",
  danger: "#ff6b6b",
  border: "#22305c",
  line: "rgba(255,255,255,0.08)",
  line2: "rgba(255,255,255,0.14)",
  statusBar: "light-content",
};

const LIGHT = {
  bg: "#f0f4ff",
  bg2: "#e4eaf5",
  card: "#ffffff",
  card2: "#f7f9ff",
  surface: "#ffffff",
  elev: "#f0f4ff",
  accent: "#1a9e65",
  accent2: "#3b6fcc",
  violet: "#6d3fcf",
  text: "#0d1530",
  muted: "#4a5578",
  muted2: "#6b7aa3",
  good: "#0fa968",
  warn: "#c47d09",
  danger: "#d63030",
  border: "#c5cfe8",
  line: "rgba(0,0,0,0.07)",
  line2: "rgba(0,0,0,0.13)",
  statusBar: "dark-content",
};

export const C = DARK;
export const PALETTES = { dark: DARK, light: LIGHT };

export const TINTS = {
  mint: "#14392e",
  indigo: "#15233f",
  violet: "#241a45",
  amber: "#3a2c12",
  rose: "#3a1622",
  slate: "#1a2547",
};

export const P2P_CURRENCIES = {
  AED: { code: "AED", flag: "\uD83C\uDDE6\uD83C\uDDEA", name: "UAE Dirham", sym: "AED" },
  SGD: { code: "SGD", flag: "\uD83C\uDDF8\uD83C\uDDEC", name: "Singapore Dollar", sym: "S$" },
  EUR: { code: "EUR", flag: "\uD83C\uDDEB\uD83C\uDDF7", name: "Euro", sym: "\u20ac" },
  NPR: { code: "NPR", flag: "\uD83C\uDDF3\uD83C\uDDF5", name: "Nepalese Rupee", sym: "Rs" },
  USD: { code: "USD", flag: "\uD83C\uDDFA\uD83C\uDDF8", name: "US Dollar", sym: "$" },
  GBP: { code: "GBP", flag: "\uD83C\uDDEC\uD83C\uDDE7", name: "British Pound", sym: "\u00a3" },
};

export const CORRIDORS = {
  AED: { flag: "\uD83C\uDDE6\uD83C\uDDEA", country: "UAE", example: "e.g. Al Masa Restaurant", sym: "AED" },
  SGD: { flag: "\uD83C\uDDF8\uD83C\uDDEC", country: "Singapore", example: "e.g. Maxwell Food Centre", sym: "S$" },
  EUR: { flag: "\uD83C\uDDEB\uD83C\uDDF7", country: "Eurozone", example: "e.g. Caf\u00e9 de Flore", sym: "\u20ac" },
  NPR: { flag: "\uD83C\uDDF3\uD83C\uDDF5", country: "Nepal", example: "e.g. Himalayan Java", sym: "Rs" },
};

export const OPERATORS = ["Airtel", "Jio", "Vi", "BSNL"];
export const BILL_CATEGORIES = ["Electricity", "Water", "Gas", "Broadband", "DTH", "Credit Card"];
export const BILLERS = {
  Electricity: ["Tata Power", "Adani Electricity", "BESCOM"],
  Water: ["Delhi Jal Board", "BWSSB"],
  Gas: ["Indane Gas", "HP Gas", "Mahanagar Gas"],
  Broadband: ["ACT Fibernet", "JioFiber", "Airtel Xstream"],
  DTH: ["Tata Play", "Airtel Digital TV", "Dish TV"],
  "Credit Card": ["HDFC Card", "ICICI Card", "SBI Card", "Axis Card"],
};

import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

export const ThemeContext = createContext(DARK);

export function ThemeProvider({ children }) {
  const scheme = useColorScheme();
  const palette = useMemo(
    () => (scheme === "light" ? LIGHT : DARK),
    [scheme]
  );
  return React.createElement(ThemeContext.Provider, { value: palette }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useThemedStyles(factory) {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme]); // eslint-disable-line react-hooks/exhaustive-deps
}
