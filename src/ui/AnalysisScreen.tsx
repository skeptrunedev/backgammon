import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  LoaderCircleIcon,
  SparklesIcon,
} from 'lucide-react';
import Board from './Board';
import { loadMatch, updateMatch } from '../game/store';
import {
  matchStats,
  severity,
  DUBIOUS,
  type Decision,
  type CheckerDecision,
  type CubeDecision,
  type MatchRecord,
} from '../game/records';
import { explainDecision } from '../ai/explain';
import { downloadText, matFilename } from './download';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

function fmtLoss(loss: number): string {
  return `${loss.toFixed(3)} (${Math.round(loss * 1000)} mEMG)`;
}

function SeverityBadge({ loss }: { loss: number }) {
  const sev = severity(loss);
  if (sev === 'blunder') return <Badge variant="destructive">Blunder</Badge>;
  if (sev === 'error')
    return (
      <Badge className="border-transparent bg-orange-500/15 text-orange-400">Error</Badge>
    );
  if (sev === 'dubious')
    return (
      <Badge className="border-transparent bg-yellow-500/15 text-yellow-400">Dubious</Badge>
    );
  return <Badge variant="secondary">OK</Badge>;
}

export default function AnalysisScreen() {
  const { id } = useParams<{ id: string }>();
  const [rec, setRec] = useState<MatchRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mistakesOnly, setMistakesOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setLoaded(true);
      return;
    }
    void loadMatch(id).then((r) => {
      if (!cancelled) {
        setRec(r ?? null);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!loaded) {
    return (
      <main className="flex justify-center py-24 text-muted-foreground">
        <LoaderCircleIcon className="size-5 animate-spin" />
      </main>
    );
  }

  if (!rec || !id) {
    return (
      <main className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-muted-foreground">Match not found.</p>
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </main>
    );
  }

  const s = matchStats(rec);
  const shown = rec.decisions
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !mistakesOnly || d.loss >= DUBIOUS);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle>
                {rec.winner === 'me'
                  ? 'You won'
                  : rec.winner === 'opponent'
                    ? 'gnubg won'
                    : 'Unfinished match'}{' '}
                {rec.myScore}–{rec.oppScore}
                <span className="ml-2 font-normal text-muted-foreground">
                  to {rec.matchLength}
                </span>
              </CardTitle>
              <CardDescription>
                {new Date(rec.startedAt).toLocaleString(undefined, {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!rec.matText}
              onClick={() =>
                rec.matText && downloadText(matFilename(rec.startedAt), rec.matText)
              }
            >
              <DownloadIcon data-icon="inline-start" />
              Download .mat
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Stat label="Decisions" value={String(s.decisions)} />
            <Stat label="Blunders (≥ 0.08)" value={String(s.blunder)} accent="text-destructive" />
            <Stat label="Errors (≥ 0.04)" value={String(s.error)} accent="text-orange-400" />
            <Stat label="Dubious (≥ 0.02)" value={String(s.dubious)} accent="text-yellow-400" />
            <Stat label="Total equity lost" value={fmtLoss(s.totalLoss)} />
            <Stat label="Avg loss / decision" value={fmtLoss(s.perDecision)} />
          </dl>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          {shown.length} of {rec.decisions.length} decisions
        </h2>
        <div className="flex items-center gap-2">
          <Switch
            id="mistakes-only"
            checked={mistakesOnly}
            onCheckedChange={setMistakesOnly}
          />
          <Label htmlFor="mistakes-only">Mistakes only</Label>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {mistakesOnly
            ? 'No mistakes — a clean match. Toggle the switch to see every decision.'
            : 'No recorded decisions in this match.'}
        </p>
      ) : (
        shown.map(({ d, i }) => (
          <DecisionCard key={i} d={d} index={i} matchId={id} onRecUpdate={setRec} />
        ))
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-medium tabular-nums ${accent ?? 'text-foreground'}`}>{value}</dd>
    </div>
  );
}

function DecisionCard({
  d,
  index,
  matchId,
  onRecUpdate,
}: {
  d: Decision;
  index: number;
  matchId: string;
  onRecUpdate: (rec: MatchRecord) => void;
}) {
  const title =
    d.kind === 'checker'
      ? 'Checker play'
      : d.sub === 'offer'
        ? 'Cube decision (double or roll)'
        : 'Cube response';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge loss={d.loss} />
          <CardTitle className="text-sm">{title}</CardTitle>
          <span className="text-xs text-muted-foreground">Game {d.gameNo}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            loss {fmtLoss(d.loss)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-1.5">
          <Board board={d.snapshot} mini showDice={false} />
          {d.kind === 'checker' && (
            <span className="text-xs text-muted-foreground">
              You rolled {d.dice[0]}-{d.dice[1]}
            </span>
          )}
        </div>
        {d.kind === 'checker' ? <CheckerDetails d={d} /> : <CubeDetails d={d} />}
        {d.loss >= DUBIOUS && (
          <ExplainSection d={d} index={index} matchId={matchId} onRecUpdate={onRecUpdate} />
        )}
      </CardContent>
    </Card>
  );
}

function CheckerDetails({ d }: { d: CheckerDecision }) {
  const [showHints, setShowHints] = useState(false);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        You played <span className="font-medium">{d.playedMove}</span>{' '}
        <span className="text-muted-foreground">
          (eq {d.playedEquity !== null ? d.playedEquity.toFixed(3) : 'not ranked'})
        </span>
        {d.loss > 0 && (
          <span className="ml-2 font-medium tabular-nums text-destructive">
            −{d.loss.toFixed(3)}
            {d.lossIsEstimate ? ' (est.)' : ''}
          </span>
        )}
      </p>
      <p>
        Best: <span className="font-medium">{d.bestMove}</span>{' '}
        <span className="text-muted-foreground">(eq {d.bestEquity.toFixed(3)})</span>
      </p>
      {d.winPctBest !== null && (
        <p className="text-muted-foreground">
          Best move wins {d.winPctBest.toFixed(1)}%
          {d.winPctPlayed !== null && <> vs your {d.winPctPlayed.toFixed(1)}%</>}
        </p>
      )}
      {d.hints.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={() => setShowHints((v) => !v)}
          >
            {showHints ? <ChevronUpIcon data-icon="inline-start" /> : <ChevronDownIcon data-icon="inline-start" />}
            Top moves
          </Button>
          {showHints && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">#</th>
                    <th className="px-3 py-1.5 font-medium">Move</th>
                    <th className="px-3 py-1.5 text-right font-medium">Equity</th>
                    <th className="px-3 py-1.5 text-right font-medium">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {d.hints.slice(0, 5).map((h) => (
                    <tr
                      key={h.rank}
                      className={
                        h.rank === d.playedRank
                          ? 'bg-primary/10 font-medium'
                          : undefined
                      }
                    >
                      <td className="px-3 py-1.5 tabular-nums">{h.rank}</td>
                      <td className="px-3 py-1.5">{h.move}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {h.equity.toFixed(3)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {h.diff === 0 ? '—' : h.diff.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CubeDetails({ d }: { d: CubeDecision }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        You chose <span className="font-medium">{d.action}</span>
        {d.loss > 0 && (
          <span className="ml-2 font-medium tabular-nums text-destructive">
            −{d.loss.toFixed(3)}
          </span>
        )}
      </p>
      <p>
        Proper action: <span className="font-medium">{d.proper}</span>
      </p>
      {d.hint.options.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">Option</th>
                <th className="px-3 py-1.5 text-right font-medium">Equity</th>
                <th className="px-3 py-1.5 text-right font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              {d.hint.options.map((o) => (
                <tr key={o.label}>
                  <td className="px-3 py-1.5">{o.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{o.equity.toFixed(3)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {o.diff === 0 ? '—' : o.diff.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExplainSection({
  d,
  index,
  matchId,
  onRecUpdate,
}: {
  d: Decision;
  index: number;
  matchId: string;
  onRecUpdate: (rec: MatchRecord) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await explainDecision(d);
      const next = await updateMatch(matchId, (rec) => {
        rec.decisions[index].explanation = text;
        return rec;
      });
      if (next) onRecUpdate(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Separator />
      {d.explanation && (
        <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
          {d.explanation}
        </div>
      )}
      <div>
        <Button variant="outline" size="sm" onClick={explain} disabled={loading}>
          {loading ? (
            <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
          ) : (
            <SparklesIcon data-icon="inline-start" />
          )}
          {loading ? 'Thinking…' : d.explanation ? 'Regenerate' : 'Explain with AI'}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive">
          {error}
          {/missing|api key/i.test(error) && <> Set it in Settings on the home screen.</>}
        </p>
      )}
    </div>
  );
}
