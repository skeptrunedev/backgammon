import type { Decision, CheckerDecision, CubeDecision } from '../game/records';
import type { BoardState } from '../engine/types';
import { pipCounts } from '../game/rules';

export interface AiSettings {
  hasKey: boolean;
  model: string;
}

// Settings live server-side per account: the Anthropic key is encrypted at rest
// and never sent back to the browser. GET reports only whether a key is set.
export async function loadAiSettings(): Promise<AiSettings> {
  const res = await fetch('/api/settings', { credentials: 'include' });
  if (res.status === 401) return { hasKey: false, model: 'claude-opus-4-8' };
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

// apiKey undefined → keep the existing key (model-only save). '' → clear it.
export async function saveAiSettings(s: { apiKey?: string; model: string }): Promise<AiSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(s),
  });
  if (res.status === 401) throw new Error('Sign in to save your Anthropic key.');
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

function describeBoard(b: BoardState): string {
  const mine: string[] = [];
  const theirs: string[] = [];
  for (let i = 24; i >= 1; i--) {
    const v = b.points[i];
    if (v > 0) mine.push(`${v} on ${i}-point`);
    if (v < 0) theirs.push(`${-v} on my ${i}-point (their ${25 - i}-point)`);
  }
  if (b.points[25] > 0) mine.push(`${b.points[25]} on the bar`);
  if (b.points[0] < 0) theirs.push(`${-b.points[0]} on the bar`);
  if (b.myOff > 0) mine.push(`${b.myOff} borne off`);
  if (b.oppOff > 0) theirs.push(`${b.oppOff} borne off`);
  const pips = pipCounts(b.points);
  return [
    `Points are numbered from my perspective: I move from 24 toward 1 and bear off from points 1-6.`,
    `My checkers: ${mine.join(', ')}.`,
    `Opponent checkers: ${theirs.join(', ')}.`,
    `Pip count: me ${pips.mine}, opponent ${pips.theirs}.`,
    `Match to ${b.matchLength}; score me ${b.myScore}, opponent ${b.oppScore}${b.crawford ? ' (Crawford game)' : ''}.`,
    `Cube: ${b.cubeValue}${b.iMayDouble && b.oppMayDouble ? ' (centered)' : b.iMayDouble ? ' (I own it)' : ' (opponent owns it)'}.`,
  ].join('\n');
}

function checkerPrompt(d: CheckerDecision): string {
  const hintLines = d.hints
    .slice(0, 6)
    .map((h) => {
      const probs = h.probs
        ? ` [win ${(h.probs[0] * 100).toFixed(1)}% g ${(h.probs[1] * 100).toFixed(1)}% bg ${(h.probs[2] * 100).toFixed(1)}% / lose g ${(h.probs[4] * 100).toFixed(1)}% bg ${(h.probs[5] * 100).toFixed(1)}%]`
        : '';
      return `${h.rank}. ${h.move}  Eq ${h.equity.toFixed(3)}${probs}`;
    })
    .join('\n');
  return [
    describeBoard(d.snapshot),
    `I rolled ${d.dice[0]}-${d.dice[1]}.`,
    `GNU Backgammon's ranked moves (2-ply):`,
    hintLines,
    `I played: ${d.playedMove} (equity ${d.playedEquity?.toFixed(3) ?? 'unranked'}).`,
    `Best was: ${d.bestMove} (equity ${d.bestEquity.toFixed(3)}). I lost ${d.loss.toFixed(3)} equity.`,
    `Explain in plain language why the best move is superior to my move in this position. Focus on the key backgammon concepts at play (racing, priming, blitzing, anchors, timing, blot exposure, duplication, cube leverage, match score). Be specific to this position. Keep it under 250 words.`,
  ].join('\n\n');
}

function cubePrompt(d: CubeDecision): string {
  const opts = d.hint.options
    .map((o) => `${o.label}: ${o.equity.toFixed(3)}`)
    .join('\n');
  const action =
    d.sub === 'offer'
      ? d.action === 'roll'
        ? 'I rolled without doubling'
        : 'I doubled'
      : `I ${d.action === 'take' ? 'took' : 'passed'} the double`;
  return [
    describeBoard(d.snapshot),
    `Cube decision. GNU Backgammon's cubeful equities:`,
    opts,
    d.hint.probs
      ? `Winning chances: ${(d.hint.probs[0] * 100).toFixed(1)}% (gammon ${(d.hint.probs[1] * 100).toFixed(1)}%).`
      : '',
    `Correct action: ${d.proper}. ${action}, losing ${d.loss.toFixed(3)} equity.`,
    `Explain in plain language why the correct cube action is right in this position (consider win chances, gammon threats, recube vig, match score, and the doubling window). Keep it under 250 words.`,
  ].join('\n\n');
}

export function buildPrompt(d: Decision): string {
  return d.kind === 'checker' ? checkerPrompt(d) : cubePrompt(d);
}

export async function explainDecision(d: Decision): Promise<string> {
  // The worker holds the (encrypted) key and calls Anthropic; we only send the
  // assembled prompt, so the key never touches the browser.
  const res = await fetch('/api/explain', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: buildPrompt(d) }),
  });
  if (res.status === 401) {
    throw new Error('Sign in and set your Anthropic key in Settings to use AI explanations.');
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Explain failed (${res.status})`);
  }
  return data.text || 'No explanation returned.';
}
