import { describe, it, expect } from 'vitest';
import type { MatchRecord, Decision } from './records';
import type { BoardState } from '../engine/types';
import { computeRating, buildTrendsPrompt } from './trends';

function fakeBoard(): BoardState {
  return {
    playerName: 'me',
    opponentName: 'gnubg',
    matchLength: 7,
    myScore: 0,
    oppScore: 0,
    points: new Array(26).fill(0),
    turn: 1,
    dice: [3, 1],
    cubeValue: 1,
    iMayDouble: true,
    oppMayDouble: true,
    wasDoubled: false,
    myOff: 0,
    oppOff: 0,
    crawford: false,
  };
}

function checker(loss: number): Decision {
  return {
    kind: 'checker',
    gameNo: 1,
    moveNo: 1,
    snapshot: fakeBoard(),
    dice: [5, 3],
    hints: [],
    playedMove: '13/8 13/10',
    playedEquity: null,
    playedRank: null,
    bestMove: '13/8 6/3',
    bestEquity: 0,
    loss,
    lossIsEstimate: false,
    winPctBest: null,
    winPctPlayed: null,
  };
}

function cube(loss: number): Decision {
  return {
    kind: 'cube',
    sub: 'offer',
    gameNo: 1,
    moveNo: 2,
    snapshot: fakeBoard(),
    hint: { cubelessEquity: null, probs: null, options: [], proper: 'double' },
    action: 'roll',
    proper: 'double',
    loss,
  };
}

function record(decisions: Decision[]): MatchRecord {
  return {
    id: 'm1',
    startedAt: 0,
    finishedAt: null,
    matchLength: 7,
    playerName: 'me',
    opponentName: 'gnubg',
    myScore: 0,
    oppScore: 0,
    winner: null,
    decisions,
    matText: null,
  };
}

describe('computeRating', () => {
  it('returns null with no decisions', () => {
    expect(computeRating([])).toBeNull();
    expect(computeRating([record([])])).toBeNull();
  });

  it('maps a single decision to the right band and stats', () => {
    const r = computeRating([record([checker(0.002)])])!;
    expect(r.games).toBe(1);
    expect(r.decisions).toBe(1);
    expect(r.avgErrorRate).toBe(2);
    expect(r.band).toBe('World class');
    expect(r.estRating).toBe(clamped(2000 - 2 * 70));
  });

  it('covers band boundaries', () => {
    // <3 -> World class
    expect(computeRating([record([checker(0.0029)])])!.band).toBe('World class');
    // 3 -> Expert (3-6)
    expect(computeRating([record([checker(0.003)])])!.band).toBe('Expert');
    // 6 -> Advanced (6-9)
    expect(computeRating([record([checker(0.006)])])!.band).toBe('Advanced');
    // 9 -> Intermediate (9-13)
    expect(computeRating([record([checker(0.009)])])!.band).toBe('Intermediate');
    // 13 -> Casual (13-18)
    expect(computeRating([record([checker(0.013)])])!.band).toBe('Casual');
    // >=18 -> Beginner
    expect(computeRating([record([checker(0.02)])])!.band).toBe('Beginner');
  });

  it('averages loss across decisions and rounds to 1 decimal', () => {
    // total loss 0.011 over 2 decisions -> 5.5 mEMG
    const r = computeRating([record([checker(0.004), checker(0.007)])])!;
    expect(r.decisions).toBe(2);
    expect(r.avgErrorRate).toBe(5.5);
    expect(r.band).toBe('Expert');
  });

  it('aggregates across multiple records and skips empty ones', () => {
    const r = computeRating([
      record([checker(0.01)]),
      record([]),
      record([cube(0.03)]),
    ])!;
    expect(r.games).toBe(2);
    expect(r.decisions).toBe(2);
  });

  it('clamps estRating to the valid range', () => {
    const high = computeRating([record([checker(0)])])!; // 0 mEMG -> 2000
    expect(high.estRating).toBe(2000);
    const low = computeRating([record([checker(0.5)])])!; // 500 mEMG -> clamp 600
    expect(low.estRating).toBe(600);
  });
});

describe('buildTrendsPrompt', () => {
  it('returns null when there are fewer than 6 mistakes', () => {
    const decisions = [
      checker(0.05),
      checker(0.05),
      checker(0.05),
      checker(0.05),
      checker(0.05),
      checker(0.001), // below DUBIOUS, not a mistake
    ];
    expect(buildTrendsPrompt([record(decisions)])).toBeNull();
  });

  it('returns a non-empty prompt with 6+ mistakes', () => {
    const decisions = [
      checker(0.065),
      checker(0.05),
      checker(0.09),
      cube(0.03),
      checker(0.04),
      cube(0.05),
    ];
    const prompt = buildTrendsPrompt([record(decisions)])!;
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('backgammon coach');
    expect(prompt).toContain('rolled 5-3');
    expect(prompt).toContain('cube');
    expect(prompt).toContain('65mEMG');
  });

  it('caps the number of mistakes shown and notes the total', () => {
    const many = record(Array.from({ length: 130 }, () => checker(0.05)));
    const prompt = buildTrendsPrompt([many])!;
    expect(prompt).toContain('130 total mistakes');
  });
});

function clamped(n: number): number {
  return Math.max(600, Math.min(2100, n));
}
