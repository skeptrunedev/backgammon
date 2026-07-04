import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Board from './Board';
import { useSession } from './useSession';
import { pipCounts } from '../game/rules';
import { BAR } from '../engine/types';
import { downloadText, matFilename } from './download';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

export default function PlayScreen() {
  const { session, state } = useSession();
  const [selected, setSelected] = useState<number | null>(null);
  const [showResign, setShowResign] = useState(false);

  const conts = useMemo(
    () => (state.phase === 'moving' ? session.continuationsNow() : []),
    [session, state.phase, state.pendingHops, state.legal],
  );

  if (!state.board) {
    return (
      <main className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-muted-foreground">
          {state.engineReady ? 'No active match.' : 'Loading engine…'}
        </p>
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </main>
    );
  }

  const b = state.board;
  const pips = pipCounts(b.points);
  const sources = [...new Set(conts.map((h) => h.from))];
  const dests = selected !== null ? conts.filter((h) => h.from === selected).map((h) => h.to) : [];

  const onPointClick = (p: number) => {
    if (state.phase !== 'moving') return;
    if (selected !== null && dests.includes(p)) {
      session.addHop({ from: selected, to: p });
      setSelected(null);
      return;
    }
    if (sources.includes(p)) {
      setSelected(p === selected ? null : p);
    }
  };

  const undo = () => {
    session.undoHops();
    setSelected(null);
  };

  const commit = async () => {
    setSelected(null);
    await session.commitMove();
  };

  const downloadMat = async () => {
    const text = await session.exportMat();
    if (text) downloadText(matFilename(Date.now()), text);
  };

  const statusMsg = state.thinking
    ? 'gnubg is thinking…'
    : state.phase === 'awaitRoll'
      ? state.canDouble
        ? 'Roll or double'
        : 'Your roll'
      : state.phase === 'moving'
        ? `Your move (${b.dice[0]}-${b.dice[1]})`
        : state.phase === 'doubleOffered'
          ? `gnubg doubles to ${b.cubeValue * 2}`
          : state.phase === 'matchOver'
            ? 'Match over'
            : '';

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-white/10 bg-card px-4 py-2.5 text-sm">
        <span className="text-foreground">
          Match to {b.matchLength}
          <span className="text-muted-foreground"> · </span>
          You {b.myScore} — {b.oppScore} gnubg
          {b.crawford && <span className="text-primary"> · Crawford</span>}
        </span>
        <Separator orientation="vertical" className="hidden h-4! sm:block" />
        <span className="text-muted-foreground">
          Pips: you {pips.mine} · gnubg {pips.theirs}
        </span>
        <span className="ml-auto font-medium text-primary">{statusMsg}</span>
      </div>

      <Board
        board={b}
        pendingHops={state.pendingHops}
        sources={state.phase === 'moving' ? sources : []}
        dests={dests}
        selected={selected}
        onPointClick={onPointClick}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        {state.phase === 'awaitRoll' && (
          <>
            <Button size="lg" onClick={() => session.roll()}>
              Roll
            </Button>
            {state.canDouble && (
              <Button size="lg" variant="outline" onClick={() => session.double()}>
                Double to {b.cubeValue === 1 ? 2 : b.cubeValue * 2}
              </Button>
            )}
          </>
        )}
        {state.phase === 'moving' && (
          <>
            <Button
              size="lg"
              variant="outline"
              onClick={undo}
              disabled={state.pendingHops.length === 0}
            >
              Undo
            </Button>
            <Button size="lg" onClick={commit} disabled={!state.canCommit}>
              Confirm move
            </Button>
            {sources.includes(BAR) && (
              <span className="text-sm text-muted-foreground">Enter from the bar</span>
            )}
          </>
        )}
        {(state.phase === 'awaitRoll' || state.phase === 'moving') && (
          <Button size="lg" variant="ghost" onClick={() => setShowResign(true)}>
            Resign
          </Button>
        )}
        {state.phase === 'matchOver' && (
          <>
            <Button size="lg" onClick={downloadMat}>
              Download .mat
            </Button>
            {state.matchId && (
              <Button size="lg" variant="outline" asChild>
                <Link to={`/match/${state.matchId}`}>View analysis</Link>
              </Button>
            )}
            <Button size="lg" variant="outline" asChild>
              <Link to="/">New match</Link>
            </Button>
          </>
        )}
      </div>

      {state.banner && (
        <div className="mx-auto w-full max-w-xl rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-center text-base font-medium text-primary">
          {state.banner}
        </div>
      )}
      {state.error && (
        <div className="mx-auto w-full max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-sm font-medium text-destructive">
          {state.error}
        </div>
      )}

      <Dialog open={state.phase === 'doubleOffered'}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Cube offered</DialogTitle>
            <DialogDescription>gnubg offers the cube at {b.cubeValue * 2}.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => session.pass()}>
              Pass
            </Button>
            <Button onClick={() => session.take()}>Take</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.phase === 'resignOffered'}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Resignation offered</DialogTitle>
            <DialogDescription>
              gnubg offers to resign{' '}
              {state.resignValue === 1
                ? 'a single game'
                : state.resignValue === 2
                  ? 'a gammon'
                  : 'a backgammon'}
              .
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => session.declineResign()}>
              Decline
            </Button>
            <Button onClick={() => session.acceptResign()}>Accept</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResign} onOpenChange={setShowResign}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resign</DialogTitle>
            <DialogDescription>How much do you want to concede?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {([1, 2, 3] as const).map((v) => (
              <Button
                key={v}
                variant="outline"
                onClick={() => {
                  setShowResign(false);
                  void session.resign(v);
                }}
              >
                {v === 1 ? 'Single' : v === 2 ? 'Gammon' : 'Backgammon'}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowResign(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
