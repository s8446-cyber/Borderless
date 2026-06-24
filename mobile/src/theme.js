// Borderless Pay — design tokens + demo directories.
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

export const CORRIDORS = {
  AED: { flag: "🇦🇪", country: "Dubai, UAE", merchant: "Al Masa Restaurant", amount: 80, sym: "AED" },
  SGD: { flag: "🇸🇬", country: "Singapore", merchant: "Maxwell Food Centre", amount: 18, sym: "S$" },
  EUR: { flag: "🇫🇷", country: "Paris, France", merchant: "Café de Flore", amount: 24, sym: "€" },
  NPR: { flag: "🇳🇵", country: "Kathmandu, Nepal", merchant: "Himalayan Java", amount: 850, sym: "Rs" },
};

// ---- Domestic (India) payment directories — GPay / PhonePe style ----
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
