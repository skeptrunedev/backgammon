// IndexedDB ↔ server match sync. Offline-first: every network failure is a
// silent no-op (console.debug only). Imports idb-keyval directly — NOT
// ./store — so store.ts can import schedulePush without a circular import.
import { get, set, keys } from 'idb-keyval';
import type { MatchRecord } from './records';

const PREFIX = 'match:';
const PUSH_DEBOUNCE_MS = 3000;

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

interface MatchSummary {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  matchLength: number;
  myScore: number;
  oppScore: number;
  winner: 'me' | 'opponent' | null;
  updatedAt: number;
  decisionCount: number;
}

let status: SyncStatus = 'idle';
const listeners = new Set<() => void>();

/** Subscribe to sync status changes (fires after each pull settles). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function setStatus(next: SyncStatus) {
  status = next;
  for (const l of listeners) l();
}

/** PUT one match to the server. Silently no-ops on 401/network failure. */
export async function pushMatch(rec: MatchRecord): Promise<void> {
  try {
    const res = await fetch(`/api/matches/${encodeURIComponent(rec.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    });
    if (!res.ok) {
      console.debug(`[sync] push ${rec.id} skipped (HTTP ${res.status})`);
    }
  } catch (err) {
    console.debug('[sync] push failed (offline?)', err);
  }
}

const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced pushMatch, per match id (3s). */
export function schedulePush(rec: MatchRecord): void {
  const prev = pushTimers.get(rec.id);
  if (prev !== undefined) clearTimeout(prev);
  pushTimers.set(
    rec.id,
    setTimeout(() => {
      pushTimers.delete(rec.id);
      void pushMatch(rec);
    }, PUSH_DEBOUNCE_MS),
  );
}

async function fetchDetail(id: string): Promise<MatchRecord | null> {
  const res = await fetch(`/api/matches/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { match: MatchRecord };
  return body.match ?? null;
}

/**
 * Return a match by id, offline-first: prefer the local IndexedDB copy; if
 * absent, try the server (cross-device) and cache it locally. On 401/network
 * error, fall back to whatever is local (or null). Direct idb writes (not the
 * hooked saveMatch) so we don't schedule a push right back.
 */
export async function fetchMatch(id: string): Promise<MatchRecord | null> {
  const local = await get<MatchRecord>(PREFIX + id);
  if (local) return local;
  try {
    const detail = await fetchDetail(id);
    if (detail) {
      await set(PREFIX + detail.id, detail);
      return detail;
    }
  } catch (err) {
    console.debug('[sync] fetchMatch failed (offline?)', err);
  }
  return null;
}

let inflightPull: Promise<number> | null = null;

/**
 * Two-way merge with the server. The record with MORE decisions wins:
 * - on server, not local            → download and save locally
 * - server decisionCount > local    → fetch detail, replace local
 * - local decisions > server        → schedulePush(local)
 * - local, not on server            → schedulePush(local)
 * Returns the number of local records added/updated.
 */
export function pullMatches(): Promise<number> {
  if (inflightPull) return inflightPull;
  inflightPull = doPull().finally(() => {
    inflightPull = null;
  });
  return inflightPull;
}

async function doPull(): Promise<number> {
  setStatus('syncing');
  let summaries: MatchSummary[];
  try {
    const res = await fetch('/api/matches');
    if (!res.ok) {
      console.debug(`[sync] pull skipped (HTTP ${res.status})`);
      setStatus(res.status === 401 ? 'idle' : 'error');
      return 0;
    }
    summaries = ((await res.json()) as { matches: MatchSummary[] }).matches ?? [];
  } catch (err) {
    console.debug('[sync] pull failed (offline?)', err);
    setStatus('error');
    return 0;
  }

  let changes = 0;
  try {
    const localIds = (await keys())
      .filter((k): k is string => typeof k === 'string' && k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length));
    const serverIds = new Set(summaries.map((s) => s.id));

    for (const summary of summaries) {
      const local = await get<MatchRecord>(PREFIX + summary.id);
      if (!local) {
        // New on server → download. Direct idb write (not the hooked
        // saveMatch) so we don't schedule a push right back.
        const detail = await fetchDetail(summary.id);
        if (detail) {
          await set(PREFIX + detail.id, detail);
          changes++;
        }
      } else if (summary.decisionCount > local.decisions.length) {
        const detail = await fetchDetail(summary.id);
        if (detail && detail.decisions.length > local.decisions.length) {
          await set(PREFIX + detail.id, detail);
          changes++;
        }
      } else if (local.decisions.length > summary.decisionCount) {
        schedulePush(local);
      }
    }

    // Local matches the server has never seen → upload history.
    for (const id of localIds) {
      if (serverIds.has(id)) continue;
      const local = await get<MatchRecord>(PREFIX + id);
      if (local) schedulePush(local);
    }

    setStatus('synced');
  } catch (err) {
    console.debug('[sync] merge failed', err);
    setStatus('error');
  }
  return changes;
}
