import { get, set, del, keys } from 'idb-keyval';
import type { MatchRecord } from './records';

const PREFIX = 'match:';

export async function saveMatch(rec: MatchRecord): Promise<void> {
  await set(PREFIX + rec.id, rec);
}

export async function loadMatch(id: string): Promise<MatchRecord | undefined> {
  return get(PREFIX + id);
}

export async function deleteMatch(id: string): Promise<void> {
  await del(PREFIX + id);
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
