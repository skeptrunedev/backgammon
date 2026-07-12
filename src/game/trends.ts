import type { MatchRecord, Decision, CheckerDecision, CubeDecision } from './records';
import { DUBIOUS } from './records';
import { pipCounts } from './rules';

export interface RatingResult {
  games: number;         // number of matches counted
  decisions: number;     // total decisions counted across all matches
  avgErrorRate: number;  // mEMG per decision = 1000 * (total equity lost) / decisions
  band: string;          // skill band label, e.g. 'Intermediate'
  estRating: number;     // rough estimated rating number
  blurb: string;         // one short sentence describing the band / what it means
}

interface Band {
  max: number; // upper bound (exclusive) in mEMG
  band: string;
  blurb: string;
}

// GNU-Backgammon-inspired skill bands, keyed on mEMG per decision.
const BANDS: Band[] = [
  {
    max: 3,
    band: 'World class',
    blurb: 'Near-flawless play that rivals the strongest bots.',
  },
  {
    max: 6,
    band: 'Expert',
    blurb: 'Very strong, tournament-caliber play with only rare slips.',
  },
  {
    max: 9,
    band: 'Advanced',
    blurb: 'Solid fundamentals with occasional costly errors to iron out.',
  },
  {
    max: 13,
    band: 'Intermediate',
    blurb: 'A capable player whose mistakes still swing games regularly.',
  },
  {
    max: 18,
    band: 'Casual',
    blurb: 'Grasps the basics but leaves meaningful equity on the table often.',
  },
  {
    max: Infinity,
    band: 'Beginner',
    blurb: 'Still learning the core ideas; big equity swings on many turns.',
  },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Aggregate ALL decisions across the given match records. Returns null if there
 * are zero decisions.
 */
export function computeRating(records: MatchRecord[]): RatingResult | null {
  let totalLoss = 0;
  let decisions = 0;
  let games = 0;

  for (const rec of records) {
    if (!rec.decisions.length) continue;
    games++;
    for (const d of rec.decisions) {
      totalLoss += d.loss;
      decisions++;
    }
  }

  if (decisions === 0) return null;

  const avgErrorRate = Math.round((1000 * totalLoss) / decisions * 10) / 10;
  const { band, blurb } = BANDS.find((b) => avgErrorRate < b.max) ?? BANDS[BANDS.length - 1];
  const estRating = clamp(Math.round(2000 - avgErrorRate * 70), 600, 2100);

  return { games, decisions, avgErrorRate, band, estRating, blurb };
}

function mEMG(loss: number): number {
  return Math.round(loss * 1000);
}

function checkerLine(d: CheckerDecision): string {
  const [a, b] = d.dice;
  const played = d.playedMove || '(no move)';
  const best = d.bestMove || '(unknown)';
  return `[${d.loss >= 0.08 ? 'blunder' : 'error'} ${mEMG(d.loss)}mEMG] rolled ${a}-${b}, played ${played}, best ${best}`;
}

function cubeLine(d: CubeDecision): string {
  const label = d.sub === 'response' ? 'cube (response)' : 'cube';
  return `[${d.loss >= 0.08 ? 'blunder' : 'error'} ${mEMG(d.loss)}mEMG] ${label}: chose ${d.action}, correct ${d.proper}`;
}

function positionHint(d: Decision): string {
  try {
    const { mine, theirs } = pipCounts(d.snapshot.points);
    return ` (pips ${mine} vs ${theirs})`;
  } catch {
    return '';
  }
}

function mistakeLine(d: Decision): string {
  const body = d.kind === 'checker' ? checkerLine(d) : cubeLine(d);
  return body + positionHint(d);
}

/**
 * Build a compact prompt for an AI coach to identify the player's COMMON,
 * RECURRING mistake areas across all their games. Returns null if there are
 * fewer than 6 mistakes total.
 */
export function buildTrendsPrompt(records: MatchRecord[]): string | null {
  const mistakes: Decision[] = [];
  for (const rec of records) {
    for (const d of rec.decisions) {
      if (d.loss >= DUBIOUS) mistakes.push(d);
    }
  }

  if (mistakes.length < 6) return null;

  // Sort worst-first so any trimming keeps the most significant mistakes.
  mistakes.sort((x, y) => y.loss - x.loss);

  const CAP = 120;
  const total = mistakes.length;
  const shown = mistakes.slice(0, CAP);
  const lines = shown.map(mistakeLine);

  const countNote =
    total > CAP
      ? `\n\n(Showing the ${CAP} most costly of ${total} total mistakes.)`
      : '';

  return `You are an expert backgammon coach. Below is a list of ALL of this player's mistakes across their games, one per line, each tagged with the equity lost in mEMG.

${lines.join('\n')}${countNote}

Identify the 3-5 GENERAL, RECURRING areas this player most needs to work on, ranked by how OFTEN they recur AND total equity lost. Explicitly IGNORE one-off mistakes that don't repeat. For each area give a short name followed by one sentence on what to focus on. Be concise: respond with a markdown bullet list and no preamble.`;
}
