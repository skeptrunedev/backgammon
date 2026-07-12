import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MatchRecord } from './records';

const PREFIX = 'match:';

// Native persistence for match records. Enough for the session's save calls;
// full history/sync can layer on later.
export async function saveMatch(rec: MatchRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + rec.id, JSON.stringify(rec));
  } catch {
    /* best-effort */
  }
}

export async function loadMatch(id: string): Promise<MatchRecord | undefined> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as MatchRecord) : undefined;
  } catch {
    return undefined;
  }
}
