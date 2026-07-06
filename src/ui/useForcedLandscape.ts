import { useSyncExternalStore } from 'react';

// True on a portrait phone-sized viewport — the case where we rotate the whole
// app 90° so it always presents in landscape. Naturally-landscape phones and
// desktops are left alone (installed PWAs get real landscape via the manifest).
const QUERY = '(orientation: portrait) and (max-width: 820px)';

function subscribe(cb: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

export function useForcedLandscape(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
