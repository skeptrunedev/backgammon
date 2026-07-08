import { get, set, del, keys } from 'idb-keyval';
import type { MatchRecord } from './records';
import { schedulePush, deleteMatchRemote } from './sync';

const PREFIX = 'match:';

export async function saveMatch(rec: MatchRecord): Promise<void> {
  await set(PREFIX + rec.id, rec);
  schedulePush(rec);
}

export async function loadMatch(id: string): Promise<MatchRecord | undefined> {
  return get(PREFIX + id);
}

export async function deleteMatch(id: string): Promise<void> {
  await del(PREFIX + id);
  // Also remove it server-side (and block any resurrecting sync), otherwise the
  // next pull re-downloads it — the "deleted match comes back on refresh" bug.
  await deleteMatchRemote(id);
}

export async function listMatches(): Promise<MatchRecord[]> {
  const ks = (await keys()).filter(
    (k) => typeof k === 'string' && k.startsWith(PREFIX),
  );
  const recs = await Promise.all(ks.map((k) => get<MatchRecord>(k)));
  return recs
    .filter((r): r is MatchRecord => !!r)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export async function updateMatch(
  id: string,
  fn: (rec: MatchRecord) => MatchRecord,
): Promise<MatchRecord | undefined> {
  const rec = await loadMatch(id);
  if (!rec) return undefined;
  const next = fn(rec);
  await saveMatch(next);
  return next;
}
