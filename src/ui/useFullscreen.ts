import { useCallback, useSyncExternalStore } from 'react';

// YouTube-style "go landscape": enter fullscreen, then lock the orientation to
// landscape. The Screen Orientation lock API only works while fullscreen, and it
// forces real device rotation even when the user has auto-rotate turned off —
// so no unlocking rotation just to use the app. Unsupported on iOS Safari
// (both calls no-op/throw there); we swallow the errors.
type OrientationLockable = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
};

export async function enterLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    }
  } catch {
    /* fullscreen denied/unsupported */
  }
  try {
    await (screen.orientation as OrientationLockable | undefined)?.lock?.('landscape');
  } catch {
    /* orientation lock denied/unsupported (e.g. iOS, desktop) */
  }
}

export async function exitLandscape(): Promise<void> {
  // Leaving fullscreen releases the orientation lock automatically.
  try {
    if (document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    /* ignore */
  }
}

function subscribe(cb: () => void) {
  document.addEventListener('fullscreenchange', cb);
  return () => document.removeEventListener('fullscreenchange', cb);
}

export function useFullscreen(): { active: boolean; toggle: () => void } {
  const active = useSyncExternalStore(
    subscribe,
    () => !!document.fullscreenElement,
    () => false,
  );
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void exitLandscape();
    else void enterLandscape();
  }, []);
  return { active, toggle };
}
