import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2Icon, ChevronRightIcon, RotateCcwIcon } from 'lucide-react';
import type { CheckerHop } from '../engine/types';
import { hopsToNotation, parseMoveString, sameCheckerPlay } from '../engine/parse';
import { continuations, isComplete, legalSequences, preferredHop } from '../game/rules';
import { cubeOfferLoss, cubeResponseLoss, DUBIOUS, severity, type Decision, type MatchRecord } from '../game/records';
import { listMatches } from '../game/store';
import { subscribe as subscribeMatchSync } from '../game/sync';
import {
  DEFAULT_REVIEW_INTERVALS,
  defaultTrainingState,
  nextReviewProgress,
  saveTrainingState,
  syncTrainingState,
  validIntervals,
  type ReviewProgress,
  type TrainingSettings,
  type TrainingState,
} from '../game/training';
import Board from './Board';
import { CheckerBoardPreview, CheckerDetails, CubeDetails, SeverityBadge } from './AnalysisScreen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type View = 'due' | 'drill' | 'library';
type Exercise = { id: string; matchId: string; index: number; match: MatchRecord; decision: Decision };
type Result = 'wrong' | 'improved' | 'best' | 'revealed' | null;

const severityName = (loss: number): TrainingSettings['severities'][number] => {
  const value = severity(loss);
  return value === 'blunder' ? 'blunder' : value === 'error' ? 'mistake' : 'inaccuracy';
};

function allExercises(matches: MatchRecord[]): Exercise[] {
  return matches.flatMap((match) => match.decisions.flatMap((decision, index) =>
    decision.loss >= DUBIOUS ? [{ id: `${match.id}:${index}`, matchId: match.id, index, match, decision }] : [],
  ));
}

export default function TrainingScreen() {
  const [search] = useSearchParams();
  const matchOnly = search.get('match');
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [training, setTraining] = useState<TrainingState>(() => defaultTrainingState());
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>(matchOnly ? 'drill' : 'due');
  const [queue, setQueue] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [libraryChoice, setLibraryChoice] = useState<string | null>(null);
  const [intervalText, setIntervalText] = useState(DEFAULT_REVIEW_INTERVALS.join(', '));
  const [intervalError, setIntervalError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listMatches(), syncTrainingState()]).then(([nextMatches, nextTraining]) => {
      if (cancelled) return;
      setMatches(nextMatches);
      setTraining(nextTraining);
      setIntervalText(nextTraining.settings.value.intervals.join(', '));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => subscribeMatchSync(() => { void listMatches().then(setMatches); }), []);

  const exercises = useMemo(() => allExercises(matches), [matches]);
  const filtered = useMemo(() => {
    const settings = training.settings.value;
    return exercises.filter((exercise) =>
      (!matchOnly || exercise.matchId === matchOnly) &&
      settings.severities.includes(severityName(exercise.decision.loss)) &&
      settings.decisionTypes.includes(exercise.decision.kind),
    );
  }, [exercises, matchOnly, training.settings.value]);

  const available = useMemo(() => {
    const now = Date.now();
    const candidates = view === 'due'
      ? filtered.filter((exercise) => {
          const progress = training.reviews[exercise.id];
          return !progress || (!progress.mastered && progress.dueAt <= now);
        })
      : filtered.filter((exercise) => view === 'library' || !training.reviews[exercise.id]?.mastered);
    return [...candidates].sort((a, b) => {
      const ap = training.reviews[a.id];
      const bp = training.reviews[b.id];
      if (ap && bp && ap.dueAt !== bp.dueAt) return ap.dueAt - bp.dueAt;
      if (!!ap !== !!bp) return ap ? -1 : 1;
      return b.decision.loss - a.decision.loss || b.match.startedAt - a.match.startedAt;
    });
  }, [filtered, training.reviews, view]);

  useEffect(() => {
    if (!loaded || view === 'library') return;
    setQueue(available.slice(0, training.settings.value.sessionSize).map((exercise) => exercise.id));
    setCursor(0);
  }, [loaded, view, training.settings.value.sessionSize, training.settings.value.severities, training.settings.value.decisionTypes]);

  const currentId = view === 'library' ? libraryChoice : queue[cursor];
  const current = exercises.find((exercise) => exercise.id === currentId) ?? null;

  const persist = async (next: TrainingState) => {
    setTraining(next);
    await saveTrainingState(next);
  };

  const updateSettings = (change: Partial<TrainingSettings>) => {
    const next = {
      ...training,
      settings: { value: { ...training.settings.value, ...change }, updatedAt: Date.now() },
    };
    void persist(next);
  };

  const finish = (cleanFirstTry: boolean) => {
    if (!current) return;
    const next = {
      ...training,
      reviews: {
        ...training.reviews,
        [current.id]: nextReviewProgress(training.reviews[current.id], training.settings.value.intervals, cleanFirstTry),
      },
    };
    void persist(next);
  };

  const nextExercise = (repeat = false) => {
    if (repeat && current && view !== 'library') {
      setQueue((items) => {
        const next = [...items];
        next.splice(Math.min(cursor + 4, next.length), 0, current.id);
        return next;
      });
    }
    if (view === 'library') setLibraryChoice(null);
    else setCursor((value) => value + 1);
  };

  const toggleSeverity = (value: TrainingSettings['severities'][number]) => {
    const currentValues = training.settings.value.severities;
    const next = currentValues.includes(value) ? currentValues.filter((item) => item !== value) : [...currentValues, value];
    if (next.length) updateSettings({ severities: next });
  };

  const toggleType = (value: TrainingSettings['decisionTypes'][number]) => {
    const currentValues = training.settings.value.decisionTypes;
    const next = currentValues.includes(value) ? currentValues.filter((item) => item !== value) : [...currentValues, value];
    if (next.length) updateSettings({ decisionTypes: next });
  };

  const saveIntervals = () => {
    const values = intervalText.split(/[ ,]+/).filter(Boolean).map(Number);
    if (!validIntervals(values)) {
      setIntervalError('Use 1 to 12 increasing whole day values between 1 and 365.');
      return;
    }
    setIntervalError('');
    updateSettings({ intervals: values });
  };

  if (!loaded) return <main className="py-24 text-center text-sm text-muted-foreground">Loading training…</main>;

  const counts = exercises.reduce((result, exercise) => {
    const progress = training.reviews[exercise.id];
    if (progress?.mastered) result.mastered += 1;
    else if (!progress) result.new += 1;
    else if (progress.dueAt <= Date.now()) result.due += 1;
    else result.learning += 1;
    return result;
  }, { due: 0, new: 0, learning: 0, mastered: 0 });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Training</h1>
        <p className="text-sm text-muted-foreground">Replay decisions from your own matches before seeing the answer.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {Object.entries(counts).map(([label, value]) => <Card key={label}><CardContent className="p-3"><strong className="text-xl tabular-nums">{value}</strong><p className="capitalize text-muted-foreground">{label}</p></CardContent></Card>)}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['due', 'drill', 'library'] as const).map((item) => <Button key={item} variant={view === item ? 'default' : 'outline'} onClick={() => { setView(item); setLibraryChoice(null); }}>{item === 'due' ? 'Due review' : item === 'drill' ? 'Session drill' : 'Library'}</Button>)}
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-5">
          <div className="flex flex-wrap gap-2">
            {(['blunder', 'mistake', 'inaccuracy'] as const).map((item) => <Button key={item} size="sm" variant={training.settings.value.severities.includes(item) ? 'secondary' : 'outline'} onClick={() => toggleSeverity(item)}>{item[0].toUpperCase() + item.slice(1)}</Button>)}
            {(['checker', 'cube'] as const).map((item) => <Button key={item} size="sm" variant={training.settings.value.decisionTypes.includes(item) ? 'secondary' : 'outline'} onClick={() => toggleType(item)}>{item === 'checker' ? 'Checker plays' : 'Cube decisions'}</Button>)}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">Session size
              <select className="h-7 rounded-lg border bg-background px-2 text-foreground" value={training.settings.value.sessionSize} onChange={(event) => updateSettings({ sessionSize: Number(event.target.value) })}>
                {[5, 10, 20, 50].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">Review schedule</summary>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input className="w-56" aria-label="Review intervals in days" value={intervalText} onChange={(event) => setIntervalText(event.target.value)} />
              <Button size="sm" onClick={saveIntervals}>Save intervals</Button>
              <Button size="sm" variant="ghost" onClick={() => { const value = [...DEFAULT_REVIEW_INTERVALS]; setIntervalText(value.join(', ')); setIntervalError(''); updateSettings({ intervals: value }); }}>Restore defaults</Button>
              {intervalError && <p className="w-full text-xs text-destructive">{intervalError}</p>}
            </div>
          </details>
        </CardContent>
      </Card>

      {view === 'library' && !current ? (
        <Card><CardHeader><CardTitle>All positions</CardTitle><CardDescription>{available.length} positions match these filters.</CardDescription></CardHeader><CardContent className="grid gap-2">
          {available.length ? available.map((exercise) => {
            const progress = training.reviews[exercise.id];
            return <button key={exercise.id} type="button" onClick={() => setLibraryChoice(exercise.id)} className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted">
              <SeverityBadge loss={exercise.decision.loss} />
              <span className="text-sm">{exercise.decision.kind === 'checker' ? `Checker play, ${exercise.decision.snapshot.dice.join(' ')}` : 'Cube decision'}</span>
              <span className="ml-auto text-xs text-muted-foreground">{progress?.mastered ? 'Mastered' : progress ? 'Learning' : 'New'}</span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </button>;
          }) : <EmptyState />}
        </CardContent></Card>
      ) : current ? (
        <ExerciseCard key={`${current.id}:${cursor}`} exercise={current} progress={training.reviews[current.id]} onFinish={finish} onNext={nextExercise} />
      ) : (
        <Card><CardContent className="py-12 text-center">
          {cursor > 0 ? <><CheckCircle2Icon className="mx-auto mb-3 size-8 text-green-500" /><p className="font-medium">Session complete</p><p className="mt-1 text-sm text-muted-foreground">Your review schedule is saved on this device.</p></> : <EmptyState due={view === 'due'} />}
        </CardContent></Card>
      )}
    </main>
  );
}

function EmptyState({ due = false }: { due?: boolean }) {
  return <div className="text-center text-sm text-muted-foreground"><p>{due ? 'Nothing is due with these filters.' : 'No saved mistakes match these filters.'}</p><Button asChild className="mt-4" variant="outline"><Link to="/">Play a match</Link></Button></div>;
}

function ExerciseCard({ exercise, progress, onFinish, onNext }: { exercise: Exercise; progress?: ReviewProgress; onFinish: (clean: boolean) => void; onNext: (repeat?: boolean) => void }) {
  const decision = exercise.decision;
  const [pending, setPending] = useState<CheckerHop[]>([]);
  const [firstDie, setFirstDie] = useState<0 | 1>(0);
  const [attempt, setAttempt] = useState<CheckerHop[]>([]);
  const [result, setResult] = useState<Result>(null);
  const [failed, setFailed] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const legal = useMemo(() => decision.kind === 'checker' ? legalSequences(decision.snapshot.points, decision.dice) : [], [decision]);
  const nextHops = useMemo(() => continuations(legal, pending), [legal, pending]);
  const sources = [...new Set(nextHops.map((hop) => hop.from))];

  const record = (clean: boolean) => {
    if (!recorded) { onFinish(clean); setRecorded(true); }
  };

  const submitChecker = () => {
    if (decision.kind !== 'checker' || !isComplete(legal, pending)) return;
    setAttempt(pending);
    const candidates = decision.acceptableMoves ?? decision.hints.filter((hint) => decision.bestEquity - hint.equity < DUBIOUS).map(({ move, equity }) => ({ move, equity }));
    const best = sameCheckerPlay(decision.snapshot.points, parseMoveString(decision.bestMove), pending);
    const acceptable = best || candidates.some((candidate) => sameCheckerPlay(decision.snapshot.points, parseMoveString(candidate.move), pending));
    if (acceptable) {
      setResult(best ? 'best' : 'improved');
      record(!failed && !hinted);
    } else {
      setFailed(true);
      setResult('wrong');
      setPending([]);
      record(false);
    }
  };

  const chooseCube = (action: 'roll' | 'double' | 'take' | 'pass') => {
    if (decision.kind !== 'cube') return;
    const loss = decision.sub === 'offer' ? cubeOfferLoss(decision.hint, action as 'roll' | 'double') : cubeResponseLoss(decision.hint, action as 'take' | 'pass');
    const good = loss < DUBIOUS;
    setResult(good ? 'best' : 'wrong');
    if (!good) setFailed(true);
    record(good && !failed && !hinted);
  };

  const reveal = () => { setResult('revealed'); setHinted(true); record(false); };
  const showAnswer = result === 'best' || result === 'improved' || result === 'revealed';
  const bestSources = decision.kind === 'checker' ? [...new Set(parseMoveString(decision.bestMove).map((hop) => hop.from))] : [];

  return <Card>
    <CardHeader><div className="flex flex-wrap items-start gap-2"><CardTitle>{decision.kind === 'checker' ? 'Find a better checker play' : decision.sub === 'offer' ? 'Roll or double?' : 'Take or pass?'}</CardTitle><span className="ml-auto text-xs text-muted-foreground">{progress?.mastered ? 'Mastered' : progress ? `Stage ${progress.stage}` : 'New'}</span></div><CardDescription>Game {decision.gameNo} from {new Date(exercise.match.startedAt).toLocaleDateString()}</CardDescription></CardHeader>
    <CardContent className="grid gap-4">
      {decision.kind === 'checker' ? <>
        <Board board={decision.snapshot} pendingHops={pending} sources={!showAnswer ? sources : []} onPointClick={(point) => { if (result && result !== 'wrong') return; const hop = preferredHop(nextHops.filter((item) => item.from === point), decision.dice, firstDie); if (hop) { setPending((items) => [...items, hop]); setResult(null); } }} activeDie={firstDie} onDieClick={(index) => setFirstDie(index as 0 | 1)} />
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setPending((items) => items.slice(0, -1)); setResult(null); }} disabled={!pending.length || showAnswer}><RotateCcwIcon data-icon="inline-start" />Undo</Button><Button onClick={submitChecker} disabled={!isComplete(legal, pending) || showAnswer}>Check play</Button></div>
      </> : <><Board board={decision.snapshot} showDice={false} /><div className="flex justify-center gap-2">{(decision.sub === 'offer' ? ['roll', 'double'] : ['pass', 'take']).map((action) => <Button key={action} variant="outline" disabled={showAnswer} onClick={() => chooseCube(action as 'roll' | 'double' | 'take' | 'pass')}>{action[0].toUpperCase() + action.slice(1)}</Button>)}</div></>}

      {result === 'wrong' && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"><p className="font-medium text-destructive">You can do better. Try again before revealing the answer.</p><div className="mt-3 flex gap-2">{decision.kind === 'checker' && <Button size="sm" variant="outline" onClick={() => setHinted(true)}>Hint</Button>}<Button size="sm" variant="ghost" onClick={reveal}>Reveal answer</Button></div>{hinted && decision.kind === 'checker' && <p className="mt-2 text-muted-foreground">Look at {bestSources.map((point) => point === 25 ? 'the bar' : `point ${point}`).join(' and ')}.</p>}</div>}

      {showAnswer && <div className="grid gap-4 rounded-lg border bg-muted/25 p-4"><div><SeverityBadge loss={decision.loss} /><p className="mt-2 text-sm">{result === 'best' ? 'Best play found.' : result === 'improved' ? 'Good improvement. You can still look for the best play.' : 'Answer revealed.'}</p></div>{decision.kind === 'checker' ? <><p className="text-sm"><span className="text-muted-foreground">Original:</span> {decision.playedMove}<br /><span className="text-muted-foreground">Attempt:</span> {attempt.length ? hopsToNotation(decision.snapshot.points, attempt) : 'Not completed'}<br /><span className="text-muted-foreground">Best:</span> {decision.bestMove}</p><CheckerBoardPreview d={decision} /><CheckerDetails d={decision} /></> : <CubeDetails d={decision} />}{decision.explanation && <p className="rounded-lg bg-background/60 p-3 text-sm text-muted-foreground">{decision.explanation}</p>}<div className="flex flex-wrap gap-2">{result === 'improved' && <Button variant="outline" onClick={() => { setPending([]); setResult(null); setRecorded(true); }}>Find the best play</Button>}<Button onClick={() => onNext(result === 'revealed' || failed)}>Next position</Button><Button asChild variant="ghost"><Link to={`/match/${exercise.matchId}`}>Source match</Link></Button></div></div>}
    </CardContent>
  </Card>;
}
