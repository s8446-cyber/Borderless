export const C = {
  bg: "#0b1020",
  bg2: "#070b16",
  card: "#121a33",
  card2: "#1a2547",
  accent: "#3ddc97",
  accent2: "#5b8cff",
  text: "#eaf0ff",
  muted: "#8b97b8",
  danger: "#ff6b6b",
  border: "#22305c",
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
