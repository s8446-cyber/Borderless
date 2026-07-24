// Route state — pure JS, unit-tested in test/routes.test.mjs.
//
// The app renders one screen at a time from a single `screen` value. This
// module centralizes (1) hardware/OS back behavior, (2) web deep links via
// the URL hash, so a browser reload or a shared link restores the right
// top-level screen, and (3) which screens show the tab bar.

export const TAB_SCREENS = ["home", "scanDom", "send", "compose", "review", "history", "txnDetail", "quote", "receipt", "contacts", "help"];

// Only stable, side-effect-free destinations are deep-linkable. Mid-payment
// screens (auth/settle/review…) must never be entered from a URL.
const HASH_FOR = {
  home: "#/home",
  history: "#/activity",
  help: "#/help",
  scanDom: "#/scan",
  send: "#/send-abroad",
};

const SCREEN_FOR = Object.fromEntries(Object.entries(HASH_FOR).map(([k, v]) => [v, k]));

export function routeToHash(screen) {
  return HASH_FOR[screen] || null;
}

export function parseHash(hash) {
  const h = String(hash || "").split("?")[0];
  return SCREEN_FOR[h] || null;
}

// Where the Android hardware back (and the on-screen back affordance) leads.
// Returns a screen name, null to swallow the event (nothing sane to go back
// to), or undefined for default OS behavior (exit).
export function backTargetFor(screen, { flow, domIntentKind, resetStage, helpFrom } = {}) {
  switch (screen) {
    case "signin":
      return resetStage && resetStage !== "none" ? "signin" : "welcome";
    case "send":
    case "scanDom":
    case "compose":
    case "contacts":
    case "history":
      return "home";
    case "txnDetail":
      return "history";
    case "help":
      return helpFrom || "home";
    case "review":
      return domIntentKind === "payrequest" ? "home" : "compose";
    case "quote":
      return "send";
    case "auth":
      return flow === "domestic" ? "review" : "quote";
    case "receipt":
      return "home";
    case "settle":
    case "lock":
    case "boot":
      return null;
    default:
      return undefined; // welcome / link / home → OS default
  }
}
