// Share one in-flight execution of an async operation. While a call is
// running, every additional caller receives the SAME promise (and therefore
// the same result or error) instead of starting a duplicate. Once it settles,
// the next call starts fresh.
//
// Why this exists: session renewal uses a ROTATING, SINGLE-USE refresh token
// with reuse detection — presenting an already-rotated token is treated by
// the server as a theft signal and revokes every session for the account.
// Two API calls racing on an expired access token must therefore share one
// renewal, never run two.
export function singleFlight(fn) {
  let inflight = null;
  return function (...args) {
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => fn(...args))
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}
