import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Board, { BOARD_W, BOARD_H, DICE_CENTER_X_PCT, BELOW_DICE_Y_PCT } from './Board';
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

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="pointer-events-none ml-1.5 rounded border border-current/25 px-1 font-sans text-[10px] font-medium leading-4 opacity-70">
      {children}
    </kbd>
  );
}

export default function PlayScreen() {
  const { session, state } = useSession();
  const [selected, setSelected] = useState<number | null>(null);
  const [showResign, setShowResign] = useState(false);

  const conts = useMemo(
    () => (state.phase === 'moving' ? session.continuationsNow() : []),
    [session, state.phase, state.pendingHops, state.legal],
  );

  // Measure the board arena so the board box (and its HTML overlay) can be
  // sized to the exact 1320:960 rectangle contained in it.
  const [arena, setArena] = useState<{ w: number; h: number } | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const arenaRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const measure = () => setArena({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  const box = useMemo(() => {
    if (!arena || arena.w <= 0 || arena.h <= 0) return null;
    const scale = Math.min(arena.w / BOARD_W, arena.h / BOARD_H);
    const w = BOARD_W * scale;
    const h = BOARD_H * scale;
    return { w, h, left: (arena.w - w) / 2, top: (arena.h - h) / 2 };
  }, [arena]);

  const undo = useCallback(() => {
    session.undoHops();
    setSelected(null);
  }, [session]);

  const commit = useCallback(async () => {
    setSelected(null);
    await session.commitMove();
  }, [session]);

  // Keyboard shortcuts: Enter = roll / confirm, Ctrl/Cmd+Z = undo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.tagName === 'BUTTON' ||
          t.isContentEditable ||
          t.closest('[role="dialog"]'))
      ) {
        return;
      }
      const dialogOpen =
        showResign || state.phase === 'doubleOffered' || state.phase === 'resignOffered';
      if (dialogOpen || state.thinking) return;

      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (state.phase === 'awaitRoll') {
          e.preventDefault();
          void session.roll();
        } else if (state.phase === 'moving' && state.canCommit) {
          e.preventDefault();
          void commit();
        }
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        if (state.phase === 'moving' && state.pendingHops.length > 0) {
          e.preventDefault();
          undo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    session,
    state.phase,
    state.canCommit,
    state.pendingHops.length,
    state.thinking,
    showResign,
    commit,
    undo,
  ]);

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

  const playing = state.phase === 'awaitRoll' || state.phase === 'moving';

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      {/* Status strip */}
      <div className="z-10 flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-white/10 bg-background/70 px-4 py-1.5 text-xs backdrop-blur sm:text-sm">
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

      {/* Board arena: board fills all remaining viewport, aspect preserved */}
      <div ref={arenaRef} className="relative m-2 min-h-0 flex-1">
        {box && (
          <div
            className="absolute"
            style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
          >
            <Board
              fill
              board={b}
              pendingHops={state.pendingHops}
              sources={state.phase === 'moving' ? sources : []}
              dests={dests}
              selected={selected}
              onPointClick={onPointClick}
            />

            {/* HTML overlay in board coordinates; only buttons take pointer events */}
            <div className="pointer-events-none absolute inset-0">
              {/* Action cluster, anchored just under the dice */}
              {playing && (
                <div
                  className="absolute flex -translate-x-1/2 flex-col items-center gap-1.5"
                  style={{ left: `${DICE_CENTER_X_PCT}%`, top: `${BELOW_DICE_Y_PCT}%` }}
                >
                  <div className="flex items-center gap-2 rounded-lg bg-background/70 p-1.5 backdrop-blur">
                    {state.phase === 'awaitRoll' && (
                      <>
                        <Button
                          className="pointer-events-auto"
                          onClick={() => void session.roll()}
                          disabled={state.thinking}
                        >
                          Roll
                          <Kbd>⏎</Kbd>
                        </Button>
                        {state.canDouble && (
                          <Button
                            className="pointer-events-auto"
                            variant="outline"
                            onClick={() => void session.double()}
                            disabled={state.thinking}
                          >
                            Double to {b.cubeValue === 1 ? 2 : b.cubeValue * 2}
                          </Button>
                        )}
                      </>
                    )}
                    {state.phase === 'moving' && (
                      <>
                        <Button
                          className="pointer-events-auto"
                          variant="outline"
                          onClick={undo}
                          disabled={state.pendingHops.length === 0 || state.thinking}
                        >
                          Undo
                          <Kbd>⌃Z</Kbd>
                        </Button>
                        <Button
                          className="pointer-events-auto"
                          onClick={() => void commit()}
                          disabled={!state.canCommit || state.thinking}
                        >
                          Confirm
                          <Kbd>⏎</Kbd>
                        </Button>
                      </>
                    )}
                  </div>
                  {state.phase === 'moving' && sources.includes(BAR) && (
                    <span className="rounded bg-background/70 px-2 py-0.5 text-xs text-muted-foreground backdrop-blur">
                      Enter from the bar
                    </span>
                  )}
                </div>
              )}

              {/* Match-over actions, centered on the board */}
              {state.phase === 'matchOver' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-background/80 p-6 backdrop-blur">
                    <p className="text-lg font-semibold text-foreground">Match over</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button onClick={downloadMat}>Download .mat</Button>
                      {state.matchId && (
                        <Button variant="outline" asChild>
                          <Link to={`/match/${state.matchId}`}>View analysis</Link>
                        </Button>
                      )}
                      <Button variant="outline" asChild>
                        <Link to="/">New match</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Resign: subtle, bottom corner of the play area */}
        {playing && (
          <Button
            size="sm"
            variant="ghost"
            className="absolute bottom-1 right-1 z-10 bg-background/60 text-muted-foreground backdrop-blur hover:text-foreground"
            onClick={() => setShowResign(true)}
          >
            Resign
          </Button>
        )}

        {/* Banner / error strips float over the board */}
        {state.banner && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 w-[min(90%,36rem)] -translate-x-1/2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-center text-base font-medium text-primary backdrop-blur">
            {state.banner}
          </div>
        )}
        {state.error && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 w-[min(90%,36rem)] -translate-x-1/2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-sm font-medium text-destructive backdrop-blur">
            {state.error}
          </div>
        )}
      </div>

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
