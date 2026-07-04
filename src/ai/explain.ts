import type { Decision, CheckerDecision, CubeDecision } from '../game/records';
import type { BoardState } from '../engine/types';
import { pipCounts } from '../game/rules';

export interface AiSettings {
  apiKey: string;
  model: string;
}

export function loadAiSettings(): AiSettings {
  return {
    apiKey: localStorage.getItem('anthropic-api-key') ?? '',
    model: localStorage.getItem('anthropic-model') ?? 'claude-sonnet-5',
  };
}

export function saveAiSettings(s: AiSettings) {
  localStorage.setItem('anthropic-api-key', s.apiKey);
  localStorage.setItem('anthropic-model', s.model);
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
  const { apiKey, model } = loadAiSettings();
  if (!apiKey) {
    throw new Error('Set your Anthropic API key in Settings first.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system:
        'You are a world-class backgammon coach. You explain engine evaluations in clear, instructive language for an improving player.',
      messages: [{ role: 'user', content: buildPrompt(d) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n');
  return text || 'No explanation returned.';
}
