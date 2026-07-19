// Borderless Pay — design tokens + service catalogs.
// Palette is intentionally aligned with the web PWA and marketing site so the
// brand reads as one product across every surface.
export const C = {
  // canvas
  bg: "#0b1020",
  bg2: "#070b16",
  // surfaces
  card: "#121a33",
  card2: "#1a2547",
  surface: "#0f1733",
  elev: "#16203f",
  // brand
  accent: "#3ddc97", // mint
  accent2: "#5b8cff", // indigo
  violet: "#8b5cf6",
  // text
  text: "#eaf0ff",
  muted: "#8b97b8",
  muted2: "#6b7aa3",
  // status
  good: "#34d399",
  warn: "#f59e0b",
  danger: "#ff6b6b",
  // lines
  border: "#22305c",
  line: "rgba(255,255,255,0.08)",
  line2: "rgba(255,255,255,0.14)",
};

// Soft per-category icon tints for the home action grid.
export const TINTS = {
  mint: "#14392e",
  indigo: "#15233f",
  violet: "#241a45",
  amber: "#3a2c12",
  rose: "#3a1622",
  slate: "#1a2547",
};

// Destination currencies a user can send money to (P2P).
export const P2P_CURRENCIES = [
  { code: "AED", flag: "🇦🇪", name: "UAE Dirham", sym: "AED" },
  { code: "SGD", flag: "🇸🇬", name: "Singapore Dollar", sym: "S$" },
  { code: "EUR", flag: "🇪🇺", name: "Euro", sym: "€" },
  { code: "NPR", flag: "🇳🇵", name: "Nepalese Rupee", sym: "Rs" },
  { code: "USD", flag: "🇺🇸", name: "US Dollar", sym: "$" },
  { code: "GBP", flag: "🇬🇧", name: "British Pound", sym: "£" },
];

// Cross-border corridor metadata: flags, currency symbols, and example
// placeholder text for the merchant field (placeholders only — the user
// enters the real merchant and amount).
export const CORRIDORS = {
  AED: { flag: "🇦🇪", country: "UAE", example: "e.g. Al Masa Restaurant", sym: "AED" },
  SGD: { flag: "🇸🇬", country: "Singapore", example: "e.g. Maxwell Food Centre", sym: "S$" },
  EUR: { flag: "🇫🇷", country: "Eurozone", example: "e.g. Café de Flore", sym: "€" },
  NPR: { flag: "🇳🇵", country: "Nepal", example: "e.g. Himalayan Java", sym: "Rs" },
};

// ---- Domestic (India) service catalogs (billers / operators) ----
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
