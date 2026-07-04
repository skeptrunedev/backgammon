import { useSyncExternalStore } from 'react';
import { getSession, Session } from '../game/session';
import type { SessionState } from '../game/session';

export function useSession(): { session: Session; state: SessionState } {
  const session = getSession();
  const state = useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.state,
  );
  return { session, state };
}
