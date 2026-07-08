import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Board, { boardMetrics } from './Board';
import { useSession } from './useSession';
import { fetchMatch } from '../game/sync';
import { pipCounts } from '../game/rules';
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
import { Menu, X, Home, Flag, Trophy, Target, Maximize, Minimize } from 'lucide-react';
import { useFullscreen } from './useFullscreen';

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="pointer-events-none ml-1.5 hidden rounded border border-current/25 px-1 font-sans text-[10px] font-medium leading-4 opacity-70 short-landscape:hidden sm:inline-block">
      {children}
    </kbd>
  );
}

export default function PlayScreen() {
  const { session, state } = useSession();
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [firstDie, setFirstDie] = useState(0);
  const [showResign, setShowResign] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { active: isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const resumeStartedRef = useRef<string | null>(null);

  // Resume-on-mount: reconstruct the engine for `matchId` unless it's already
  // the live in-memory session (just-started or same tab). Cross-device pulls
  // fetch the record from the server first.
  useEffect(() => {
    if (!matchId || !state.engineReady) return;
    // Already the live session — leave gameplay untouched.
    if (state.matchId === matchId && state.phase !== 'boot') return;
    if (resumeStartedRef.current === matchId) return;
    resumeStartedRef.current = matchId;
    let cancelled = false;
    void (async () => {
      const record = await fetchMatch(matchId);
      if (cancelled) return;
      if (record && record.finishedAt == null && record.resumeState) {
        await session.resumeMatch(record);
      } else if (record && record.finishedAt != null) {
        navigate(`/match/${matchId}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, state.engineReady, state.matchId, state.phase, session, navigate]);

  const conts = useMemo(
    () => (state.phase === 'moving' ? session.continuationsNow() : []),
    [session, state.phase, state.pendingHops, state.legal],
  );

  // Reset the preferred die whenever a fresh roll arrives.
  const rollKey = `${state.board?.dice[0]}-${state.board?.dice[1]}-${state.phase}`;
  useEffect(() => {
    setFirstDie(0);
  }, [rollKey]);

  // Landscape phones (matching the `short-landscape` CSS variant) get the wide
  // board layout that fills the full viewport width. Desktop/portrait keep the
  // default 1320×960 board.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // Wide board for short landscape phones, and for portrait phones (which the
    // app rotates 90° into landscape — the rotated view is landscape-and-short).
    const shortLandscape = window.matchMedia('(orientation: landscape) and (max-height: 600px)');
    const portraitPhone = window.matchMedia('(orientation: portrait) and (max-width: 820px)');
    const apply = () => setWide(shortLandscape.matches || portraitPhone.matches);
    apply();
    shortLandscape.addEventListener('change', apply);
    portraitPhone.addEventListener('change', apply);
    return () => {
      shortLandscape.removeEventListener('change', apply);
      portraitPhone.removeEventListener('change', apply);
    };
  }, []);

  // Measure the board arena so the board box (and its HTML overlay) can be
  // sized to the board rectangle it contains.
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

  const metrics = useMemo(() => boardMetrics(wide), [wide]);

  const box = useMemo(() => {
    if (!arena || arena.w <= 0 || arena.h <= 0) return null;
    // Contain (letterbox) to preserve the board aspect and never overflow. In
    // wide mode the board aspect (~2.2:1) is close to the landscape-phone
    // viewport, so the letterbox collapses and the board fills nearly the full
    // width.
    const scale = Math.min(arena.w / metrics.w, arena.h / metrics.h);
    const w = metrics.w * scale;
    const h = metrics.h * scale;
    return { w, h, left: (arena.w - w) / 2, top: (arena.h - h) / 2 };
  }, [arena, metrics]);

  const undo = useCallback(() => {
    session.undoHops();
  }, [session]);

  const commit = useCallback(async () => {
    await session.commitMove();
  }, [session]);

  // Keyboard shortcuts: Enter = roll / confirm, Ctrl/Cmd+Z = undo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // While the drawer is open, Escape closes it and all game shortcuts are
      // suppressed so Enter/Ctrl+Z don't fire behind it.
      if (drawerOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setDrawerOpen(false);
        }
        return;
      }
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
    drawerOpen,
    commit,
    undo,
  ]);

  if (!state.board) {
    const loading =
      !state.engineReady ||
      state.thinking ||
      (!!matchId && state.matchId !== matchId);
    return (
      <main className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-muted-foreground">
          {!state.engineReady
            ? 'Loading engine…'
            : loading
              ? 'Loading game…'
              : 'No active match.'}
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

  const hopDist = (h: { from: number; to: number }) =>
    h.from - (h.to === 0 ? 0 : h.to);

  // Single click: play the checker on `p` using the preferred die if it's
  // legal from there, otherwise the other die. (Combined moves are made with
  // successive clicks, since continuations recompute after each hop.)
  const onPointClick = (p: number) => {
    if (state.phase !== 'moving') return;
    const fromP = conts.filter((h) => h.from === p);
    if (fromP.length === 0) return;
    const order = firstDie === 0 ? [b.dice[0], b.dice[1]] : [b.dice[1], b.dice[0]];
    for (const d of order) {
      const hop = fromP.find((h) => hopDist(h) === d);
      if (hop) {
        session.addHop(hop);
        return;
      }
    }
    session.addHop(fromP[0]);
  };

  const onDieClick = () => setFirstDie((f) => (f === 0 ? 1 : 0));

  const downloadMat = async () => {
    const text = await session.exportMat();
    if (text) downloadText(matFilename(Date.now()), text);
  };

  // No "gnubg is thinking…" status — the pill just hides during gnubg's turn.
  const statusMsg =
    state.phase === 'awaitRoll'
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
    <main className="relative flex min-h-0 w-full flex-1 flex-col">
      {/* Menu button — opens the side drawer. Anchored top-left over the board,
          notch-safe in short landscape. Replaces the old full-width status bar. */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open menu"
        className="absolute left-2 top-2 z-20 flex size-9 items-center justify-center rounded-lg border border-white/10 bg-background/70 text-muted-foreground backdrop-blur transition-colors hover:text-foreground short-landscape:left-[max(0.5rem,env(safe-area-inset-left))] short-landscape:top-[max(0.5rem,env(safe-area-inset-top))] short-landscape:size-8"
      >
        <Menu className="size-5" />
      </button>

      {/* Fullscreen + landscape lock (YouTube-style): forces real landscape even
          when the phone's rotation is locked, so the app is usable without
          toggling auto-rotate. No-ops on browsers that don't support it. */}
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen landscape'}
        className="absolute right-2 top-2 z-20 flex size-9 items-center justify-center rounded-lg border border-white/10 bg-background/70 text-muted-foreground backdrop-blur transition-colors hover:text-foreground short-landscape:right-[max(0.5rem,env(safe-area-inset-right))] short-landscape:top-[max(0.5rem,env(safe-area-inset-top))] short-landscape:size-8"
      >
        {isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
      </button>

      {/* Live status — a compact floating pill so whose-turn-it-is stays visible
          without a bar. Hidden during the cube-offer phase (its own banner shows). */}
      {statusMsg && state.phase !== 'doubleOffered' && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-background/70 px-3 py-1 text-xs font-medium text-primary backdrop-blur sm:text-sm short-landscape:top-[max(0.5rem,env(safe-area-inset-top))] short-landscape:text-[11px]">
          {statusMsg}
        </div>
      )}

      {/* Side drawer — holds navigation, match info, and resign, replacing the
          old top bar. Slides in from the left over a dimmed backdrop. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[80vw] flex-col gap-5 border-r border-white/10 bg-card p-4 pl-[max(1rem,env(safe-area-inset-left))] shadow-2xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Backgammon</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                navigate('/');
              }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <Home className="size-4" />
              Home
            </button>

            <Separator />

            <div className="flex flex-col gap-4 px-1">
              <div className="flex items-start gap-3">
                <Trophy className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="text-sm">
                  <div className="text-foreground">Match to {b.matchLength}</div>
                  <div className="text-muted-foreground">
                    You {b.myScore} — {b.oppScore} gnubg
                    {b.crawford && <span className="text-primary"> · Crawford</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="text-sm">
                  <div className="text-foreground">Pip count</div>
                  <div className="text-muted-foreground">
                    You {pips.mine} · gnubg {pips.theirs}
                  </div>
                </div>
              </div>
            </div>

            {playing && (
              <>
                <Separator />
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    setShowResign(true);
                  }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  <Flag className="size-4" />
                  Resign
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Board arena: board fills all remaining viewport, aspect preserved. In
          short landscape the margin collapses (and gives way to notch-safe
          insets) so the height-constrained board grows to fill the height. */}
      <div
        ref={arenaRef}
        className="relative m-2 min-h-0 flex-1 short-landscape:ml-[max(0px,env(safe-area-inset-left))] short-landscape:mr-[max(0px,env(safe-area-inset-right))] short-landscape:mb-[max(0.5rem,env(safe-area-inset-bottom))] short-landscape:mt-2"
      >
        {box && (
          <div
            className="absolute"
            style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
          >
            <Board
              fill
              wide={wide}
              board={b}
              pendingHops={state.pendingHops}
              sources={state.phase === 'moving' ? sources : []}
              onPointClick={onPointClick}
              activeDie={firstDie}
              onDieClick={state.phase === 'moving' ? onDieClick : undefined}
            />

            {/* HTML overlay in board coordinates; only buttons take pointer events */}
            <div className="pointer-events-none absolute inset-0">
              {/* Action cluster, anchored just under the dice */}
              {playing && (
                <div
                  className="absolute flex -translate-x-1/2 flex-col items-center gap-1.5"
                  style={{ left: `${metrics.diceCenterXPct}%`, top: `${metrics.belowDiceYPct}%` }}
                >
                  <div className="flex items-center gap-2 rounded-lg bg-background/70 p-1.5 backdrop-blur short-landscape:gap-1 short-landscape:p-1">
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
                          className="pointer-events-auto short-landscape:h-7 short-landscape:gap-1 short-landscape:px-2.5 short-landscape:text-xs"
                          variant="outline"
                          onClick={undo}
                          disabled={state.pendingHops.length === 0 || state.thinking}
                        >
                          Undo
                          <Kbd>⌃Z</Kbd>
                        </Button>
                        <Button
                          className="pointer-events-auto short-landscape:h-7 short-landscape:gap-1 short-landscape:px-2.5 short-landscape:text-xs"
                          onClick={() => void commit()}
                          disabled={!state.canCommit || state.thinking}
                        >
                          Confirm
                          <Kbd>⏎</Kbd>
                        </Button>
                      </>
                    )}
                  </div>
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
