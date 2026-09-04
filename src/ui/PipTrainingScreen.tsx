import { useEffect, useMemo, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { BoardState } from '../engine/types';
import { listMatches } from '../game/store';
import { subscribe as subscribeMatchSync } from '../game/sync';
import { pipAnswer, pipBreakdown, type PipMethod } from '../game/pipTraining';
import { syncTrainingState, updateTrainingState, type PipStats } from '../game/training';
import Board from './Board';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { MatchRecord } from '../game/records';

type Mode = 'learn' | 'practice' | 'speed';
type AnswerMode = 'relative' | 'exact' | 'both';
type MethodChoice = PipMethod | 'mixed';

const METHODS: { value: PipMethod; label: string; summary: string; steps: string[] }[] = [
  { value: 'urquhart', label: 'Urquhart Colorless', summary: 'Ignore ownership and balance the board in three increasingly precise passes.', steps: ['Pair the fifteen checkers nearest each end and count full quadrant crossovers at six pips each.', 'Count the remaining half quadrant crossovers at three pips each.', 'Within each triad, add the one and two pip offsets to make the result exact.'] },
  { value: '321', label: '321 Colorless', summary: 'Build a fast multiple of three estimate, then make one exact unit adjustment.', steps: ['Ignoring color, weight your home board by three, your outfield by two, and the opponent outfield by one.', 'Double that quadrant tally.', 'Add the checkers in the four clockwise three point bands, then subtract the tally from 105 and multiply by three.', 'Adjust checkers from each triad center by one pip, including the special bar adjustment.'] },
  { value: 'criss-cross', label: 'Criss Cross', summary: 'Compare matching areas across the board and keep only their signed differences.', steps: ['Count the four signed outer triads using the Criss Cross diagram.', 'Double the difference between the two midpoint triads.', 'Multiply the difference between escaped stray checkers by five.', 'Add those values and multiply the tally by three.', 'Apply the same exact unit adjustment from each triad center.'] },
];

function sampleBoard(): BoardState {
  const points = Array(26).fill(0);
  points[24] = 2; points[13] = 4; points[10] = 1; points[8] = 2; points[6] = 5; points[4] = 1;
  points[1] = -2; points[12] = -5; points[17] = -3; points[19] = -5;
  return { playerName: 'You', opponentName: 'Opponent', matchLength: 7, myScore: 0, oppScore: 0, points, turn: 1, dice: [0, 0], cubeValue: 1, iMayDouble: true, oppMayDouble: true, wasDoubled: false, myOff: 0, oppOff: 0, crawford: false };
}

function personalPositions(matches: MatchRecord[]): BoardState[] {
  const seen = new Set<string>();
  return matches.flatMap((match) => match.decisions.flatMap((decision) => {
    const key = decision.snapshot.points.join(',');
    if (seen.has(key)) return [];
    seen.add(key);
    return [decision.snapshot];
  }));
}

export default function PipTrainingScreen() {
  const [mode, setMode] = useState<Mode>('learn');
  const [methodChoice, setMethodChoice] = useState<MethodChoice>('urquhart');
  const [answerMode, setAnswerMode] = useState<AnswerMode>('relative');
  const [positions, setPositions] = useState<BoardState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [methodIndex, setMethodIndex] = useState(0);
  const [mine, setMine] = useState('');
  const [theirs, setTheirs] = useState('');
  const [leader, setLeader] = useState<'you' | 'opponent' | 'tied'>('you');
  const [margin, setMargin] = useState('');
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null);
  const [seconds, setSeconds] = useState(30);
  const [customSeconds, setCustomSeconds] = useState(45);
  const [remaining, setRemaining] = useState(30);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const [savedStats, setSavedStats] = useState<PipStats | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [learnStep, setLearnStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listMatches().then((matches) => {
      if (!cancelled) { setPositions(personalPositions(matches)); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => subscribeMatchSync(() => {
    void listMatches().then((matches) => setPositions(personalPositions(matches)));
  }), []);

  useEffect(() => {
    void syncTrainingState().then((state) => {
      const pref = state.pipPreferences.value;
      setMethodChoice(pref.method);
      setAnswerMode(pref.answer === 'counts' ? 'exact' : pref.answer);
      if (pref.seconds !== null) { setSeconds(pref.seconds); setRemaining(pref.seconds); }
      if (pref.method !== 'mixed') setSavedStats(state.pipStats[pref.method]);
    });
  }, []);

  const remember = (nextMethod = methodChoice, nextAnswer = answerMode, nextSeconds: number | null = seconds) => {
    void updateTrainingState((state) => ({ ...state, pipPreferences: { value: { method: nextMethod, answer: nextAnswer === 'exact' ? 'counts' : nextAnswer, seconds: nextSeconds }, updatedAt: Date.now() } }));
  };

  const recordAttempt = (correct: boolean) => {
    const elapsed = Date.now() - startedAt;
    void updateTrainingState((state) => {
      const old = state.pipStats[method];
      const next = { attempts: old.attempts + 1, correct: old.correct + Number(correct), totalMs: old.totalMs + elapsed, bestMs: correct ? Math.min(old.bestMs ?? elapsed, elapsed) : old.bestMs, updatedAt: Date.now() };
      setSavedStats(next);
      return { ...state, pipStats: { ...state.pipStats, [method]: next } };
    });
  };

  useEffect(() => {
    if (mode !== 'speed' || seconds <= 0 || result || !positions.length) return;
    const timer = window.setInterval(() => setRemaining((n) => {
      if (n > 1) return n - 1;
      if (n <= 0) return 0;
      setResult('wrong'); setStats((s) => ({ ...s, total: s.total + 1 })); recordAttempt(false); return 0;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [mode, seconds, result, positions.length, index]);

  const method = methodChoice === 'mixed' ? METHODS[methodIndex % METHODS.length].value : methodChoice;
  const board = mode === 'learn' ? sampleBoard() : positions[index % Math.max(positions.length, 1)];
  const answer = useMemo(() => board ? pipAnswer(board) : null, [board]);
  const breakdown = useMemo(() => board ? pipBreakdown(board.points, method) : null, [board, method]);

  const submit = () => {
    if (!answer) return;
    const relativeOk = Number(margin) === answer.margin && (answer.leader === 'Tied' ? leader === 'tied' : answer.leader === 'You' ? leader === 'you' : leader === 'opponent');
    const exactOk = Number(mine) === answer.mine && Number(theirs) === answer.theirs;
    const correct = answerMode === 'relative' ? relativeOk : answerMode === 'exact' ? exactOk : relativeOk && exactOk;
    setResult(correct ? 'correct' : 'wrong');
    setStats((s) => ({ correct: s.correct + Number(correct), total: s.total + 1 }));
    recordAttempt(correct);
  };

  const next = () => {
    setIndex((n) => n + 1); setMethodIndex((n) => n + 1);
    setMine(''); setTheirs(''); setMargin(''); setResult(null); setRemaining(seconds); setStartedAt(Date.now());
  };

  const methodSelector = <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">Method<select className="h-8 min-w-0 w-full rounded-lg border bg-background px-2 text-sm text-foreground" value={methodChoice} onChange={(e) => { const v = e.target.value as MethodChoice; setMethodChoice(v); setLearnStep(0); remember(v); }}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}{mode !== 'learn' && <option value="mixed">Mixed</option>}</select></label>;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Pip counting</h1><p className="text-sm text-muted-foreground">Learn a colorless method, then build speed on positions from your own matches.</p></div>
      <div className="flex flex-wrap gap-2">{(['learn', 'practice', 'speed'] as Mode[]).map((v) => <Button key={v} variant={mode === v ? 'default' : 'outline'} onClick={() => { setMode(v); setResult(null); setRemaining(seconds); setStartedAt(Date.now()); setLearnStep(0); }}>{v[0].toUpperCase() + v.slice(1)}</Button>)}</div>

      {mode !== 'learn' && <Card><CardContent className="flex flex-wrap gap-3 pt-5">
        {methodSelector}
        <label className="grid gap-1 text-xs text-muted-foreground">Answer<select className="h-8 rounded-lg border bg-background px-2 text-sm text-foreground" value={answerMode} onChange={(e) => { const v = e.target.value as AnswerMode; setAnswerMode(v); remember(methodChoice, v); }}><option value="relative">Leader and margin</option><option value="exact">Both exact counts</option><option value="both">Exact counts, leader, and margin</option></select></label>
        {mode === 'speed' && <><label className="grid gap-1 text-xs text-muted-foreground">Timer<select className="h-8 rounded-lg border bg-background px-2 text-sm text-foreground" value={seconds === 0 ? '0' : [15, 30, 60].includes(seconds) ? String(seconds) : 'custom'} onChange={(e) => { const n = e.target.value === 'custom' ? customSeconds : Number(e.target.value); setSeconds(n); setRemaining(n); remember(methodChoice, answerMode, n); }}><option value="0">Untimed</option><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="custom">Custom</option></select></label>{seconds > 0 && ![15, 30, 60].includes(seconds) && <label className="grid gap-1 text-xs text-muted-foreground">Custom seconds<Input className="w-28" type="number" min={5} max={300} value={customSeconds} onChange={(e) => { const n = Math.min(300, Math.max(5, Number(e.target.value) || 5)); setCustomSeconds(n); setSeconds(n); setRemaining(n); remember(methodChoice, answerMode, n); }} /></label>}</>}
      </CardContent></Card>}

      {!loaded ? <div className="flex justify-center py-20"><LoaderCircleIcon className="size-5 animate-spin" /></div> : mode !== 'learn' && !positions.length ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Play an analyzed match to add personal positions. Learn mode is ready now.</CardContent></Card> : board && <div className={mode === 'learn' ? 'grid grid-cols-[minmax(0,1.45fr)_minmax(8rem,0.75fr)] items-start gap-2 sm:gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.75fr)]' : 'contents'}>
        <div className={`mx-auto w-full ${mode === 'learn' ? 'max-w-[38rem]' : 'max-w-3xl'}`}><Board board={board} showDice={false} /></div>
        {mode === 'learn' ? <Card className="min-w-0 overflow-hidden"><CardHeader className="min-w-0 p-3 pb-2 sm:p-6 sm:pb-3"><CardTitle className="break-words text-sm sm:text-lg">{METHODS.find((m) => m.value === method)?.label}</CardTitle></CardHeader><CardContent className="grid min-w-0 gap-2 p-3 pt-0 sm:gap-3 sm:p-6 sm:pt-0">{methodSelector}<p className="hidden text-sm text-muted-foreground sm:block">{METHODS.find((m) => m.value === method)?.summary}</p>{breakdown?.stages.slice(0, learnStep).map((stage, i) => <div key={stage.label} className="min-w-0 rounded-lg bg-muted px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm"><div className="flex min-w-0 gap-1 sm:justify-between"><span className="min-w-0 break-words">{i + 1}. {stage.label}</span><strong className="ml-auto shrink-0 tabular-nums">{stage.value > 0 ? '+' : ''}{stage.value}</strong></div><p className="mt-1 hidden text-xs text-muted-foreground sm:block">{METHODS.find((m) => m.value === method)?.steps[i]}</p></div>)}{learnStep < (breakdown?.stages.length ?? 0) ? <Button className="h-8 w-full whitespace-normal px-1 text-xs leading-tight sm:h-9 sm:px-2 sm:text-sm" onClick={() => setLearnStep((value) => value + 1)}>Show step {learnStep + 1}</Button> : <><p className="min-w-0 break-words text-xs sm:text-sm">Result: <strong>{answer?.leader} leads by {answer?.margin} pips</strong> ({answer?.mine} to {answer?.theirs}).</p><Button className="h-auto min-h-8 w-full whitespace-normal px-1 py-1 text-xs leading-tight sm:min-h-9 sm:px-2 sm:text-sm" variant="outline" onClick={() => setLearnStep(0)}>Work through it again</Button></>}</CardContent></Card> : <Card><CardContent className="grid gap-4 pt-5">
          <div className="flex justify-between text-sm"><span>{METHODS.find((m) => m.value === method)?.label}</span><span className="tabular-nums">{mode === 'speed' && seconds > 0 ? `${remaining}s · ` : ''}{stats.correct}/{stats.total} correct{savedStats?.attempts ? ` · lifetime ${Math.round(savedStats.correct / savedStats.attempts * 100)}%` : ''}</span></div>
          {(answerMode === 'exact' || answerMode === 'both') && <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-xs text-muted-foreground">Your count<Input inputMode="numeric" value={mine} onChange={(e) => setMine(e.target.value)} /></label><label className="grid gap-1 text-xs text-muted-foreground">Opponent count<Input inputMode="numeric" value={theirs} onChange={(e) => setTheirs(e.target.value)} /></label></div>}
          {(answerMode === 'relative' || answerMode === 'both') && <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-xs text-muted-foreground">Leader<select className="h-8 rounded-lg border bg-background px-2 text-sm text-foreground" value={leader} onChange={(e) => setLeader(e.target.value as typeof leader)}><option value="you">You</option><option value="opponent">Opponent</option><option value="tied">Tied</option></select></label><label className="grid gap-1 text-xs text-muted-foreground">Margin<Input inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value)} /></label></div>}
          {!result ? <Button onClick={submit}>Check answer</Button> : <><p className={result === 'correct' ? 'text-sm text-green-500' : 'text-sm text-destructive'}>{result === 'correct' ? 'Correct.' : `Not quite. ${answer?.leader} leads by ${answer?.margin}, ${answer?.mine} to ${answer?.theirs}.`}</p>{result === 'wrong' && mode === 'practice' && <div className="grid gap-2">{breakdown?.stages.map((stage) => <div key={stage.label} className="flex justify-between rounded-lg bg-muted px-3 py-2 text-xs"><span>{stage.label}</span><strong>{stage.value > 0 ? '+' : ''}{stage.value}</strong></div>)}</div>}<Button onClick={next}>Next position</Button></>}
        </CardContent></Card>}
      </div>}
    </main>
  );
}
