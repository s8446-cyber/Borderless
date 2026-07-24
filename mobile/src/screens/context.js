// AppContext — thin wrapper around the state lifted from App.js.
// Screens import useApp() instead of receiving every prop through 3 levels of
// component trees. This keeps App.js as the single source of truth while
// giving individual screens clean access to what they need.
import React, { createContext, useContext } from "react";

export const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppContext.Provider>");
  return ctx;
}
