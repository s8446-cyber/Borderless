// Connectivity state — pure JS, unit-tested in test/net.test.mjs.
//
// There is no NetInfo dependency in this app, so the API client itself is
// the connectivity oracle: every fetch that fails at the network layer marks
// the app offline, and every response (any status) marks it online. The UI
// subscribes to show a persistent offline banner instead of failing silently.

let _online = true;
const subs = new Set();

export function isOnline() {
  return _online;
}

export function setOnline(next) {
  const v = Boolean(next);
  if (v === _online) return;
  _online = v;
  for (const cb of subs) {
    try {
      cb(v);
    } catch {
      /* a broken subscriber must not break connectivity reporting */
    }
  }
}

// Returns an unsubscribe function.
export function subscribeOnline(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
