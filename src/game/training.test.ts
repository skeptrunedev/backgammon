import { describe, expect, it } from 'vitest';
import { defaultTrainingState, mergeTrainingState, nextReviewProgress, validIntervals } from './training';

describe('training state', () => {
  it('validates transparent custom schedules', () => {
    expect(validIntervals([1, 3, 7, 14, 30])).toBe(true);
    expect(validIntervals([])).toBe(false);
    expect(validIntervals([1, 1])).toBe(false);
    expect(validIntervals([0, 3])).toBe(false);
    expect(validIntervals([1, 366])).toBe(false);
  });

  it('merges independently timestamped fields and review items', () => {
    const local = defaultTrainingState(10);
    const remote = defaultTrainingState(5);
    local.settings.value.sessionSize = 20;
    local.reviews.a = { stage: 2, dueAt: 30, mastered: false, failures: 0, updatedAt: 20 };
    remote.reviews.a = { stage: 0, dueAt: 5, mastered: false, failures: 1, updatedAt: 15 };
    remote.reviews.b = { stage: 1, dueAt: 10, mastered: false, failures: 0, updatedAt: 25 };
    remote.pipPreferences.updatedAt = 30;
    remote.pipPreferences.value.method = '321';

    const merged = mergeTrainingState(local, remote);
    expect(merged.settings.value.sessionSize).toBe(20);
    expect(merged.reviews.a.stage).toBe(2);
    expect(merged.reviews.b.stage).toBe(1);
    expect(merged.pipPreferences.value.method).toBe('321');
  });

  it('advances clean reviews and resets missed positions to tomorrow', () => {
    const intervals = [1, 3];
    const first = nextReviewProgress(undefined, intervals, true, 1_000);
    expect(first).toMatchObject({ stage: 1, dueAt: 1_000 + 86_400_000, mastered: false });
    const second = nextReviewProgress(first, intervals, true, 2_000);
    expect(second).toMatchObject({ stage: 2, dueAt: 2_000 + 3 * 86_400_000, mastered: false });
    expect(nextReviewProgress(second, intervals, true, 3_000).mastered).toBe(true);
    expect(nextReviewProgress(second, intervals, false, 4_000)).toMatchObject({ stage: 0, dueAt: 4_000 + 86_400_000, failures: 1 });
  });
});
