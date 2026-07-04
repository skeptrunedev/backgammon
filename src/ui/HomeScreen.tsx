import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SettingsIcon, Trash2Icon, DownloadIcon, PlayIcon } from 'lucide-react';
import { useSession } from './useSession';
import { useUser } from '../auth/client';
import { listMatches, deleteMatch } from '../game/store';
import { subscribe as subscribeSync, getSyncStatus, type SyncStatus } from '../game/sync';
import { matchStats, type MatchRecord } from '../game/records';
import { loadAiSettings, saveAiSettings } from '../ai/explain';
import { downloadText, matFilename } from './download';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const MATCH_LENGTHS = ['1', '3', '5', '7', '11'];

const PLY_OPTIONS = [
  { value: '0', label: 'Fast (0-ply)' },
  { value: '1', label: 'Advanced (1-ply)' },
  { value: '2', label: 'World class (2-ply)' },
];

export default function HomeScreen() {
  const { session, state } = useSession();
  const { user } = useUser();
  const navigate = useNavigate();
  const [length, setLength] = useState('7');
  const [plies, setPlies] = useState('2');
  const [matches, setMatches] = useState<MatchRecord[]>([]);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());

  const refresh = useCallback(() => {
    void listMatches().then(setMatches);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-read the local list whenever a server pull settles.
  useEffect(
    () =>
      subscribeSync(() => {
        setSyncStatus(getSyncStatus());
        refresh();
      }),
    [refresh],
  );

  const matchInProgress =
    state.matchId !== null &&
    state.phase !== 'idle' &&
    state.phase !== 'boot' &&
    state.phase !== 'matchOver';

  const start = () => {
    const id = crypto.randomUUID();
    void session.newMatch(id, Number(length), Number(plies));
    navigate('/play/' + id);
  };

  const inProgress = matches.filter((m) => m.finishedAt == null);
  const finished = matches.filter((m) => m.finishedAt != null);

  const onDelete = async (rec: MatchRecord) => {
    if (!window.confirm('Delete this match and its analysis? This cannot be undone.')) return;
    await deleteMatch(rec.id);
    refresh();
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>New match</CardTitle>
              <CardDescription>
                Play against GNU Backgammon with full mistake analysis.
              </CardDescription>
            </div>
            <SettingsDialog />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="match-length">Match length</Label>
              <Select value={length} onValueChange={setLength}>
                <SelectTrigger id="match-length" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH_LENGTHS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v} point{v === '1' ? '' : 's'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-strength">AI strength</Label>
              <Select value={plies} onValueChange={setPlies}>
                <SelectTrigger id="ai-strength" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="lg" onClick={start} disabled={!state.engineReady}>
              {state.engineReady ? 'Start match' : 'Loading engine…'}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            2-ply is standard tournament strength; 0-ply is fast and beatable.
          </p>
        </CardContent>
        {matchInProgress && state.matchId && (
          <CardFooter className="border-t border-white/10 pt-4!">
            <Button variant="outline" asChild>
              <Link to={`/play/${state.matchId}`}>
                <PlayIcon data-icon="inline-start" />
                Resume current match
              </Link>
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Match history</CardTitle>
          <p className="text-xs text-muted-foreground">
            {user
              ? syncStatus === 'error'
                ? 'Sync failed — offline?'
                : `Synced to ${user.email}`
              : 'Sign in to back up matches across devices.'}
          </p>
          <CardDescription>
            Finished and in-progress matches stored in this browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {matches.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No matches yet. Play one and it will show up here with a full mistake report.
            </p>
          ) : (
            <>
              {inProgress.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    In progress
                  </p>
                  <ul className="flex flex-col">
                    {inProgress.map((rec, idx) => (
                      <li key={rec.id}>
                        {idx > 0 && <Separator className="my-3" />}
                        <MatchRow rec={rec} onDelete={() => onDelete(rec)} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {finished.length > 0 && (
                <div className="flex flex-col gap-2">
                  {inProgress.length > 0 && (
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Finished
                    </p>
                  )}
                  <ul className="flex flex-col">
                    {finished.map((rec, idx) => (
                      <li key={rec.id}>
                        {idx > 0 && <Separator className="my-3" />}
                        <MatchRow rec={rec} onDelete={() => onDelete(rec)} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function MatchRow({ rec, onDelete }: { rec: MatchRecord; onDelete: () => void }) {
  const s = matchStats(rec);
  const unfinished = rec.finishedAt == null;
  const result =
    rec.winner === 'me' ? 'You won' : rec.winner === 'opponent' ? 'gnubg won' : 'In progress';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span
            className={
              rec.winner === 'me'
                ? 'font-medium text-primary'
                : rec.winner === 'opponent'
                  ? 'font-medium text-foreground'
                  : 'font-medium text-muted-foreground'
            }
          >
            {result}
          </span>
          <span className="text-foreground">
            {rec.myScore}–{rec.oppScore}
          </span>
          <span className="text-muted-foreground">to {rec.matchLength}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(rec.startedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {s.decisions} decisions · {s.blunder} blunder{s.blunder === 1 ? '' : 's'} · {s.error}{' '}
          error{s.error === 1 ? '' : 's'} · {(s.perDecision * 1000).toFixed(1)} mEMG/decision
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {unfinished ? (
          <Button size="sm" asChild>
            <Link to={`/play/${rec.id}`}>
              <PlayIcon data-icon="inline-start" />
              Resume
            </Link>
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/match/${rec.id}`}>Analysis</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!rec.matText}
              onClick={() => rec.matText && downloadText(matFilename(rec.startedAt), rec.matText)}
            >
              <DownloadIcon data-icon="inline-start" />
              .mat
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Delete match" onClick={onDelete}>
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}

function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');

  useEffect(() => {
    if (open) {
      const s = loadAiSettings();
      setApiKey(s.apiKey);
      setModel(s.model);
    }
  }, [open]);

  const save = () => {
    saveAiSettings({ apiKey: apiKey.trim(), model: model.trim() });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <SettingsIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Used by the “Explain with AI” feature on the analysis screen.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="anthropic-key">Anthropic API key</Label>
            <Input
              id="anthropic-key"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Stored only in this browser's localStorage.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="anthropic-model">Model</Label>
            <Input
              id="anthropic-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
