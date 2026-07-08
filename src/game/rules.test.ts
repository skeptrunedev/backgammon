import { describe, it, expect } from 'vitest';
import { legalSequences, continuations, isComplete, pipCounts, dieUsage, deadDice } from './rules';
import { parseMoveString, applyHopsToPoints, sameCheckerPlay, hopsToMoveCommand, hopsToNotation, applyOppHop } from '../engine/parse';
import { BAR, OFF } from '../engine/types';

function startingPoints(): number[] {
  const p = new Array(26).fill(0);
  p[24] = 2; p[13] = 5; p[8] = 3; p[6] = 5;
  p[1] = -2; p[12] = -5; p[17] = -3; p[19] = -5;
  return p;
}

describe('legalSequences', () => {
  it('generates 3-1 opening plays using both dice', () => {
    const seqs = legalSequences(startingPoints(), [3, 1]);
    expect(seqs.every((s) => s.length === 2)).toBe(true);
    const eightFive = seqs.find(
      (s) =>
        s.some((h) => h.from === 8 && h.to === 5) &&
        s.some((h) => h.from === 6 && h.to === 5),
    );
    expect(eightFive).toBeTruthy();
  });

  it('generates 4 hops for doubles', () => {
    const seqs = legalSequences(startingPoints(), [2, 2]);
    expect(seqs.every((s) => s.length === 4)).toBe(true);
  });

  it('forces entering from the bar first', () => {
    const p = startingPoints();
    p[24] = 1;
    p[BAR] = 1;
    const seqs = legalSequences(p, [6, 2]);
    for (const seq of seqs) {
      expect(seq[0].from).toBe(BAR);
    }
  });

  it('returns single empty sequence when fully blocked', () => {
    const p = new Array(26).fill(0);
    p[BAR] = 2;
    for (let i = 19; i <= 24; i++) p[i] = -2;
    p[12] = 13;
    const seqs = legalSequences(p, [3, 5]);
    expect(seqs).toEqual([[]]);
    expect(isComplete(seqs, [])).toBe(true);
  });

  it('requires the larger die when only one die is playable', () => {
    const p = new Array(26).fill(0);
    p[24] = 1;
    p[18] = -2;
    p[1] = 14;
    const seqs = legalSequences(p, [2, 4]);
    expect(seqs.length).toBe(1);
    expect(seqs[0]).toEqual([{ from: 24, to: 20 }]);
  });

  it('allows bearing off with exact and oversized dice', () => {
    const p = new Array(26).fill(0);
    p[5] = 2;
    p[3] = 2;
    p[1] = 11;
    const seqs = legalSequences(p, [6, 3]);
    const offs = seqs.flat().filter((h) => h.to === OFF);
    expect(offs.length).toBeGreaterThan(0);
    expect(offs.some((h) => h.from === 5)).toBe(true);
    expect(offs.some((h) => h.from === 3)).toBe(true);
  });

  it('forbids oversized bear-off when higher points are occupied', () => {
    const p = new Array(26).fill(0);
    p[6] = 1;
    p[3] = 2;
    p[1] = 12;
    const seqs = legalSequences(p, [5, 5]);
    expect(seqs.length).toBeGreaterThan(0);
    for (const seq of seqs) {
      expect(seq[0]).toEqual({ from: 6, to: 1 });
    }
  });
});

describe('continuations', () => {
  it('offers next hops matching the played prefix', () => {
    const seqs = legalSequences(startingPoints(), [3, 1]);
    const first = seqs[0][0];
    const nexts = continuations(seqs, [first]);
    expect(nexts.length).toBeGreaterThan(0);
  });
});

describe('move string parsing', () => {
  it('parses simple moves', () => {
    expect(parseMoveString('8/5 6/5')).toEqual([
      { from: 8, to: 5 },
      { from: 6, to: 5 },
    ]);
  });

  it('parses bar, off, hits and repeats', () => {
    expect(parseMoveString('bar/22* 24/18')).toEqual([
      { from: BAR, to: 22 },
      { from: 24, to: 18 },
    ]);
    expect(parseMoveString('6/off(2)')).toEqual([
      { from: 6, to: OFF },
      { from: 6, to: OFF },
    ]);
    expect(parseMoveString('13/11(2) 6/4(2)')).toHaveLength(4);
  });

  it('parses chained combined moves', () => {
    expect(parseMoveString('24/18*/14')).toEqual([
      { from: 24, to: 18 },
      { from: 18, to: 14 },
    ]);
  });

  it('round-trips to a gnubg move command', () => {
    expect(hopsToMoveCommand(parseMoveString('bar/22 6/off'))).toBe(
      'bar/22 6/off',
    );
  });
});

describe('hopsToNotation', () => {
  it('marks a hit with * on the landing point', () => {
    const p = new Array(26).fill(0);
    p[21] = 1;
    p[16] = -1; // opponent blot on 16
    const s = hopsToNotation(p, [
      { from: 21, to: 16 },
      { from: 16, to: 14 },
    ]);
    expect(s).toBe('21/16* 16/14');
  });

  it('does not mark non-hitting moves or bear-offs', () => {
    const p = startingPoints();
    expect(hopsToNotation(p, parseMoveString('8/5 6/5'))).toBe('8/5 6/5');
    const bear = new Array(26).fill(0);
    bear[6] = 2;
    expect(hopsToNotation(bear, [{ from: 6, to: OFF }])).toBe('6/off');
  });
});

describe('position application', () => {
  it('applies a hit by sending the blot to the opponent bar', () => {
    const p = new Array(26).fill(0);
    p[6] = 2;
    p[4] = -1;
    const after = applyHopsToPoints(p, [{ from: 6, to: 4 }]);
    expect(after[6]).toBe(1);
    expect(after[4]).toBe(1);
    expect(after[0]).toBe(-1);
  });

  it('recognizes identical plays reached via different hop orders', () => {
    const p = startingPoints();
    const a = parseMoveString('13/11 11/8');
    const b = parseMoveString('13/8');
    expect(sameCheckerPlay(p, a, b)).toBe(true);
  });
});

describe('dieUsage', () => {
  it('attributes hops to the matching die', () => {
    expect(dieUsage([3, 1], [])).toEqual([0, 0]);
    expect(dieUsage([3, 1], [{ from: 8, to: 5 }])).toEqual([1, 0]);
    expect(dieUsage([3, 1], [{ from: 6, to: 5 }])).toEqual([0, 1]);
    expect(
      dieUsage([3, 1], [{ from: 8, to: 5 }, { from: 6, to: 5 }]),
    ).toEqual([1, 1]);
  });

  it('handles bar entry distances', () => {
    expect(dieUsage([6, 2], [{ from: BAR, to: 19 }])).toEqual([1, 0]);
    expect(dieUsage([6, 2], [{ from: BAR, to: 23 }])).toEqual([0, 1]);
  });

  it('attributes oversized bear-offs to a larger unused die', () => {
    expect(dieUsage([6, 3], [{ from: 5, to: OFF }])).toEqual([1, 0]);
    expect(
      dieUsage([6, 3], [{ from: 3, to: OFF }, { from: 5, to: OFF }]),
    ).toEqual([1, 1]);
  });

  it('counts doubles in halves across two dice', () => {
    const hop = { from: 13, to: 11 };
    expect(dieUsage([2, 2], [hop])).toEqual([1, 0]);
    expect(dieUsage([2, 2], [hop, hop])).toEqual([2, 0]);
    expect(dieUsage([2, 2], [hop, hop, hop])).toEqual([2, 1]);
    expect(dieUsage([2, 2], [hop, hop, hop, hop])).toEqual([2, 2]);
  });
});

describe('deadDice', () => {
  it('marks neither die dead in a normal position', () => {
    expect(deadDice(startingPoints(), [3, 1])).toEqual([false, false]);
  });

  it('marks the die dead whose bar entry is blocked and unusable', () => {
    const p = new Array(26).fill(0);
    p[BAR] = 2;
    p[22] = -2; // blocks entry with a 3 (25-3)
    p[1] = 13;
    const [deadA, deadB] = deadDice(p, [3, 1]);
    expect(deadA).toBe(true);
    expect(deadB).toBe(false);
  });

  it('marks both dead on a full dance from the bar', () => {
    const p = new Array(26).fill(0);
    p[BAR] = 2;
    for (let i = 19; i <= 24; i++) p[i] = -2;
    p[1] = 11;
    expect(deadDice(p, [3, 5])).toEqual([true, true]);
  });

  it('keeps a blocked-entry die live when one bar checker can still use it after entering', () => {
    const p = new Array(26).fill(0);
    p[BAR] = 1;
    p[22] = -2; // 3 can't enter, but after entering with 1 the 3 plays elsewhere
    p[13] = 2;
    p[8] = 2;
    expect(deadDice(p, [3, 1])).toEqual([false, false]);
  });
});

describe('applyOppHop', () => {
  it('maps gnubg points (25-N) and moves a negative checker', () => {
    const p = new Array(26).fill(0);
    p[1] = -2; // gnubg's 24-point = human index 1
    const after = applyOppHop(p, { from: 24, to: 23 });
    expect(after[1]).toBe(-1);
    expect(after[2]).toBe(-1); // gnubg's 23-point = human index 2
  });

  it('hits a human blot, sending it to the human bar', () => {
    const p = new Array(26).fill(0);
    p[1] = -1;
    p[2] = 1; // human blot where gnubg lands
    const after = applyOppHop(p, { from: 24, to: 23 });
    expect(after[2]).toBe(-1);
    expect(after[25]).toBe(1); // human checker on the bar
  });

  it('enters gnubg from the bar', () => {
    const p = new Array(26).fill(0);
    p[0] = -1; // gnubg on its bar
    const after = applyOppHop(p, { from: 25, to: 22 });
    expect(after[0]).toBe(0);
    expect(after[3]).toBe(-1); // gnubg's 22-point = human index 3
  });
});

describe('pipCounts', () => {
  it('computes 167 for the starting position on both sides', () => {
    const { mine, theirs } = pipCounts(startingPoints());
    expect(mine).toBe(167);
    expect(theirs).toBe(167);
  });
});
