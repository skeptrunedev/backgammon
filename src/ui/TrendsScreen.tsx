import { useCallback, useEffect, useState } from 'react';
import { InfoIcon, LoaderCircleIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { listMatches } from '../game/store';
import { type MatchRecord } from '../game/records';
import { computeRating, buildTrendsPrompt, type RatingResult } from '../game/trends';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Tailwind-styled elements for the AI analysis markdown (avoids the typography
// plugin). Preflight strips default margins, so spacing is set explicitly.
const mdComponents: Components = {
  p: (props) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-2 list-disc pl-5 last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-2 list-decimal pl-5 last:mb-0" {...props} />,
  li: (props) => <li className="mb-1 last:mb-0" {...props} />,
  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  h1: (props) => <h3 className="mb-1 mt-2 font-semibold text-foreground first:mt-0" {...props} />,
  h2: (props) => <h3 className="mb-1 mt-2 font-semibold text-foreground first:mt-0" {...props} />,
  h3: (props) => <h3 className="mb-1 mt-2 font-semibold text-foreground first:mt-0" {...props} />,
  code: (props) => (
    <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]" {...props} />
  ),
  a: (props) => <a className="text-primary underline" {...props} />,
};

// Persist the AI analysis so it survives navigation and full page refreshes.
const ANALYSIS_CACHE_KEY = 'bg:trends-analysis:v1';

interface CachedAnalysis {
  sig: string;
  text: string;
}

// Small djb2-style string hash → base-36. Used to build a cheap, deterministic
// signature of the analysis input so the cache auto-invalidates when the player
// has new games/mistakes (which change the prompt).
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function readAnalysisCache(): CachedAnalysis | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedAnalysis>;
    if (typeof parsed?.sig === 'string' && typeof parsed?.text === 'string') {
      return { sig: parsed.sig, text: parsed.text };
    }
    return null;
  } catch {
    return null;
  }
}

function writeAnalysisCache(entry: CachedAnalysis): void {
  try {
    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage can throw in private mode / when full — ignore.
  }
}

const SYSTEM_PROMPT =
  "You are a world-class backgammon coach reviewing an improving player's recurring mistakes across many games. Identify the 3-5 patterns that cost the most equity and matter most to fix. Respond ONLY as a markdown bullet list — each bullet a **bold short label** followed by one concise, specific sentence of advice. Rank by importance. No preamble, no headings, no closing remarks.";

const MEMG_HINT =
  'mEMG = milli-EMG: thousandths of a point of normalized equity (EMG) lost per decision — the standard "distance from perfect play" error rate used by engines like GNU Backgammon / XG. Lower is better; world-class play is under ~3 per decision.';

export default function TrendsScreen() {
  const [records, setRecords] = useState<MatchRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listMatches().then((r) => {
      if (!cancelled) {
        setRecords(r);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rating = loaded ? computeRating(records) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Trends</h1>
        <p className="text-sm text-muted-foreground">
          Your skill estimate and recurring mistake patterns across all your matches.
        </p>
      </div>

      {!loaded ? (
        <main className="flex justify-center py-24 text-muted-foreground">
          <LoaderCircleIcon className="size-5 animate-spin" />
        </main>
      ) : (
        <>
          <RatingCard rating={rating} />
          <MistakesCard records={records} />
        </>
      )}
    </main>
  );
}

function RatingCard({ rating }: { rating: RatingResult | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Skill estimate</CardTitle>
        <CardDescription>Based on equity lost per decision across your matches.</CardDescription>
      </CardHeader>
      <CardContent>
        {!rating ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No games analyzed yet.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {rating.band}
                </span>
                <span className="text-sm text-muted-foreground">{rating.blurb}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-lg font-medium tabular-nums text-primary">
                  Estimated rating ~{rating.estRating}
                </span>
                <span className="text-xs text-muted-foreground">
                  a rough estimate from match play
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Stat
                  label="Error rate"
                  value={`${rating.avgErrorRate} mEMG per decision`}
                  hint={MEMG_HINT}
                />
                <Stat label="Games" value={String(rating.games)} />
                <Stat label="Decisions" value={String(rating.decisions)} />
              </dl>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {MEMG_HINT}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MistakesCard({ records }: { records: MatchRecord[] }) {
  const prompt = buildTrendsPrompt(records);
  const sig = prompt ? hash(prompt) : '';
  const [text, setText] = useState<string | null>(null);
  const [cachedSig, setCachedSig] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, hydrate from the persisted analysis so it shows without re-fetching.
  useEffect(() => {
    const cache = readAnalysisCache();
    if (cache) {
      setText(cache.text);
      setCachedSig(cache.sig);
    }
  }, []);

  // A cached result whose signature no longer matches the current input means
  // the player has played more games since it was generated.
  const stale = text !== null && cachedSig !== null && sig !== '' && cachedSig !== sig;

  const run = useCallback(async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, maxTokens: 1024, system: SYSTEM_PROMPT }),
      });
      if (res.status === 401) {
        throw new Error(
          'Sign in and set your Anthropic key in Settings to see your trend analysis.',
        );
      }
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Analysis failed (${res.status})`);
      }
      const result = data.text || 'No analysis returned.';
      setText(result);
      setCachedSig(sig);
      writeAnalysisCache({ sig, text: result });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [prompt, sig]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Common mistakes</CardTitle>
            <CardDescription>
              The recurring areas an AI coach thinks you should work on.
            </CardDescription>
          </div>
          {prompt && (
            <Button variant="outline" size="sm" onClick={run} disabled={loading}>
              {loading ? (
                <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              Refresh
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!prompt ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Play a few more games — need at least ~6 mistakes to spot patterns.
          </p>
        ) : loading && text === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Analyzing your mistakes…
          </div>
        ) : error ? (
          <p className="py-4 text-sm text-destructive">{error}</p>
        ) : text !== null ? (
          <div className="flex flex-col gap-2">
            {stale && (
              <p className="text-xs text-muted-foreground">
                New games since this analysis — Refresh to update.
              </p>
            )}
            <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm leading-relaxed text-foreground/90">
              <ReactMarkdown components={mdComponents}>{text}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Analyze your recurring mistakes to see where to focus next.
            </p>
            <Button onClick={run}>
              <SparklesIcon data-icon="inline-start" />
              Analyze my trends
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {hint && (
          <span
            title={hint}
            aria-label={hint}
            role="img"
            className="inline-flex cursor-help text-muted-foreground/70"
          >
            <InfoIcon className="size-3" aria-hidden="true" />
          </span>
        )}
      </dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
