import { getEngine, GnubgClient } from '../engine/client';
import type { BoardState, CheckerHop, CubeHint, EngineEvent, HintMove } from '../engine/types';
import { parseCheckerHints, parseCubeHint, parseMoveString, hopsToMoveCommand, sameCheckerPlay } from '../engine/parse';
import { legalSequences, continuations, isComplete } from './rules';
import type { Decision, MatchRecord } from './records';
import { buildCheckerDecision, cubeOfferLoss, cubeResponseLoss } from './records';
import { saveMatch } from './store';

export type Phase =
  | 'boot'
  | 'idle'
  | 'awaitRoll'
  | 'moving'
  | 'aiTurn'
  | 'doubleOffered'
  | 'resignOffered'
  | 'matchOver';

export interface SessionState {
  phase: Phase;
  board: BoardState | null;
  pendingHops: CheckerHop[];
  legal: CheckerHop[][];
  canDouble: boolean;
  canCommit: boolean;
  resignValue: number;
  banner: string | null;
  error: string | null;
  thinking: boolean;
  matchId: string | null;
  engineReady: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AI_STEP_DELAY_MS = 900;
// Beat after the human confirms a move (their move is on the board) before
// gnubg starts its turn, so the handoff doesn't feel instant.
const PAUSE_AFTER_MOVE_MS = 750;

export class Session {
  private engine: GnubgClient;
  private listeners = new Set<() => void>();
  private board: BoardState | null = null;
  private resignOffered = 0;
  private gameEndText: string | null = null;
  private matchEndText: string | null = null;
  private record: MatchRecord | null = null;
  private gameNo = 1;
  private lastScoreKey = '0:0';
  private boardAtDecision: BoardState | null = null;
  private moveHintPromise: Promise<HintMove[]> | null = null;
  private cubeHintPromise: Promise<CubeHint | null> | null = null;
  private responseHintPromise: Promise<CubeHint | null> | null = null;
  private settling = false;
  // True between the human offering a double and gnubg responding to it, so the
  // pending-cube board state is handled as gnubg's response, not shown to us.
  private humanDoubled = false;

  state: SessionState = {
    phase: 'boot',
    board: null,
    pendingHops: [],
    legal: [],
    canDouble: false,
    canCommit: false,
    resignValue: 0,
    banner: null,
    error: null,
    thinking: false,
    matchId: null,
    engineReady: false,
  };

  constructor() {
    this.engine = getEngine();
    this.engine.onEvent((ev) => this.onEngineEvent(ev));
    this.engine.readyPromise
      .then(() => this.update({ engineReady: true, phase: 'idle' }))
      .catch((e) => this.update({ error: String(e) }));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(partial: Partial<SessionState>) {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  private onEngineEvent(ev: EngineEvent) {
    if (ev.type === 'board') {
      this.board = ev.state;
      const scoreKey = `${ev.state.myScore}:${ev.state.oppScore}`;
      if (scoreKey !== this.lastScoreKey) {
        this.lastScoreKey = scoreKey;
        this.gameNo += 1;
        void this.persist();
      }
      // A fresh board from the engine supersedes any pending-move preview.
      // Clear the preview atomically with the new board so the move animates
      // straight to its result — never flashing back to the pre-move position.
      // (Never while 'moving': that's the human's own in-progress preview.)
      const clearPreview =
        this.state.phase !== 'moving' && this.state.pendingHops.length > 0;
      this.update(clearPreview ? { board: ev.state, pendingHops: [] } : { board: ev.state });
    } else if (ev.type === 'resignOffer') {
      this.resignOffered = ev.value;
    } else if (ev.type === 'line') {
      const t = ev.text;
      if (/win[s]? the match|has won the match|wins the .* match/i.test(t)) {
        this.matchEndText = t;
      } else if (/win[s]? (a|\d)/i.test(t) && /point|game|gammon|backgammon/i.test(t)) {
        this.gameEndText = t;
      }
    }
  }

  private boardKey(b: BoardState): string {
    return [b.points.join(','), b.turn, b.dice.join(','), b.cubeValue, b.wasDoubled, b.myScore, b.oppScore].join('|');
  }

  /** Player/eval strength commands, shared by newMatch and resumeMatch. */
  private async applyEngineSetup(aiPlies: number) {
    for (const cmd of [
      `set player 0 chequerplay evaluation plies ${aiPlies}`,
      'set player 0 chequerplay evaluation prune on',
      `set player 0 cubedecision evaluation plies ${aiPlies}`,
      `set evaluation chequerplay evaluation plies ${aiPlies}`,
      'set evaluation chequerplay evaluation prune on',
      `set evaluation cubedecision evaluation plies ${aiPlies}`,
    ]) {
      const out = await this.engine.command(cmd);
      for (const line of out) console.debug('[gnubg setup]', cmd, '->', line);
    }
  }

  async newMatch(id: string, length: number, aiPlies: number) {
    if (!this.state.engineReady) return;
    this.gameNo = 1;
    this.lastScoreKey = '0:0';
    this.gameEndText = null;
    this.matchEndText = null;
    this.resignOffered = 0;
    this.humanDoubled = false;
    this.board = null;
    this.record = {
      id,
      startedAt: Date.now(),
      finishedAt: null,
      matchLength: length,
      playerName: 'You',
      opponentName: 'gnubg',
      myScore: 0,
      oppScore: 0,
      winner: null,
      decisions: [],
      matText: null,
      aiPlies,
    };
    this.update({
      matchId: this.record.id,
      banner: null,
      error: null,
      pendingHops: [],
      legal: [],
      thinking: true,
    });
    await this.applyEngineSetup(aiPlies);
    await this.act(`new match ${length}`);
    await this.engine.command('set player 1 name You');
    await this.settle();
  }

  /**
   * Rebuild a match from its persisted gnubg SGF (record.resumeState). Applies
   * the same strength setup, loads the SGF into the engine VFS, restores
   * counters, then settles to a stable (pre-roll) state. Live decisions already
   * in the record are preserved; load match replays internally so settle() adds
   * no duplicate decisions.
   */
  async resumeMatch(record: MatchRecord) {
    if (!this.state.engineReady) return;
    if (!record.resumeState) return; // caller (UI) handles missing/finished
    this.gameNo = record.decisions.length
      ? Math.max(...record.decisions.map((d) => d.gameNo))
      : 1;
    this.lastScoreKey = `${record.myScore}:${record.oppScore}`;
    this.gameEndText = null;
    this.matchEndText = null;
    this.resignOffered = 0;
    this.humanDoubled = false;
    this.board = null;
    this.record = record;
    this.update({
      matchId: record.id,
      banner: null,
      error: null,
      pendingHops: [],
      legal: [],
      thinking: true,
    });
    await this.applyEngineSetup(record.aiPlies ?? 2);
    await this.engine.writeFile('/resume.sgf', record.resumeState);
    // `load match` will auto-play the pending on-roll move (advancing the
    // position by the saved roll) when automatic play is on. Disable it around
    // the load so the position is restored exactly as saved, then re-enable.
    await this.engine.command('set automatic game off');
    await this.engine.command('set automatic move off');
    await this.act('load match "/resume.sgf"');
    await this.engine.command('set player 1 name You');
    // Force the human back on roll with their exact roll, so resume shows the
    // same position and dice (and gnubg does NOT get to play an extra move).
    await this.engine.command('set turn 1');
    const pd = record.pendingDice;
    if (pd && pd[0] > 0) {
      await this.engine.command(`set dice ${pd[0]} ${pd[1]}`);
    }
    await this.engine.command('set automatic game on');
    await this.act('show board');
    await this.settle();
  }

  /**
   * Capture the engine's current match state as an SGF and persist it into the
   * record so the game can be resumed later (this tab, or another device after
   * sign-in). Called at every stable, user-facing point.
   */
  private async snapshot() {
    if (!this.record) return;
    try {
      await this.engine.command('save match "/resume.sgf"');
      this.record.resumeState = await this.engine.readFile('/resume.sgf');
      this.record.pendingDice = this.board
        ? [this.board.dice[0], this.board.dice[1]]
        : [0, 0];
      await this.persist();
    } catch (e) {
      console.debug('snapshot failed', e);
    }
  }

  private async act(cmd: string): Promise<string[]> {
    this.board = null;
    return this.engine.command(cmd);
  }

  private matchIsOver(b: BoardState | null): boolean {
    if (this.matchEndText) return true;
    return !!b && b.matchLength > 0 && (b.myScore >= b.matchLength || b.oppScore >= b.matchLength);
  }

  private async settle() {
    if (this.settling) return;
    this.settling = true;
    this.update({ thinking: true });
    try {
      let quiet = 0;
      for (let i = 0; i < 1000; i++) {
        const b = this.board;
        if (this.matchIsOver(b)) {
          await this.finishMatch();
          return;
        }
        if (this.gameEndText) {
          this.update({ banner: this.gameEndText });
          this.gameEndText = null;
          void this.persist();
        }
        if (this.resignOffered > 0) {
          await this.snapshot();
          this.update({ phase: 'resignOffered', resignValue: this.resignOffered, thinking: false });
          return;
        }
        if (!b) {
          const lines = await this.engine.nextTurn();
          if (lines.length === 0 && !this.board) {
            quiet += 1;
            if (quiet % 4 === 3) await this.engine.command('show board');
            if (quiet > 20) {
              this.update({ thinking: false, error: 'Engine stalled — try a new match.' });
              return;
            }
          } else {
            quiet = 0;
          }
          continue;
        }
        if (!b.wasDoubled) this.humanDoubled = false;
        if (b.wasDoubled) {
          // We offered the double: it's gnubg's turn to respond (take/drop),
          // which it does automatically — pump for it, don't prompt ourselves.
          if (this.humanDoubled) {
            this.update({ phase: 'aiTurn' });
            const prevKey = this.boardKey(b);
            const lines = await this.engine.nextTurn();
            const nowKey = this.board ? this.boardKey(this.board) : '';
            if (lines.length === 0 && nowKey === prevKey) {
              await this.act('play');
            } else {
              await sleep(AI_STEP_DELAY_MS);
            }
            continue;
          }
          // gnubg doubled us: it's our decision to take or pass.
          this.boardAtDecision = b;
          // Snapshot the clean position BEFORE any `hint` — running a hint
          // first corrupts the subsequent `save match` (resume plays the roll).
          await this.snapshot();
          this.responseHintPromise = this.engine
            .command('hint')
            .then(parseCubeHint)
            .catch(() => null);
          this.update({ phase: 'doubleOffered', thinking: false });
          return;
        }
        if (b.turn === 1 && b.dice[0] > 0) {
          const legal = legalSequences(b.points, b.dice);
          if (legal.length === 1 && legal[0].length === 0) {
            this.board = null;
            await this.engine.nextTurn();
            continue;
          }
          this.boardAtDecision = b;
          await this.snapshot();
          this.moveHintPromise = this.engine
            .command('hint 200')
            .then(parseCheckerHints)
            .catch(() => []);
          this.update({ phase: 'moving', legal, pendingHops: [], canCommit: false, thinking: false });
          return;
        }
        if (b.turn === 1 && b.dice[0] === 0) {
          const canDouble = b.iMayDouble && !b.crawford && b.cubeValue < 64;
          this.boardAtDecision = b;
          await this.snapshot();
          this.cubeHintPromise = canDouble
            ? this.engine.command('hint').then(parseCubeHint).catch(() => null)
            : null;
          this.update({ phase: 'awaitRoll', canDouble, thinking: false });
          return;
        }
        const prevKey = this.boardKey(b);
        this.update({ phase: 'aiTurn' });
        const lines = await this.engine.nextTurn();
        const nowKey = this.board ? this.boardKey(this.board) : '';
        if (lines.length === 0 && nowKey === prevKey) {
          quiet += 1;
          // doNextTurn didn't advance the opponent — its turn engine may be
          // unarmed (e.g. just after a resume). Kick it with `play`.
          if (b.turn === -1) await this.act('play');
          if (quiet > 20) {
            this.update({ thinking: false, error: 'Engine stalled — try a new match.' });
            return;
          }
        } else {
          quiet = 0;
          await sleep(AI_STEP_DELAY_MS);
        }
      }
      this.update({ thinking: false, error: 'Engine did not settle.' });
    } finally {
      this.settling = false;
    }
  }

  private async finishMatch() {
    const b = this.board;
    const matText = await this.exportMat();
    if (this.record) {
      this.record.finishedAt = Date.now();
      this.record.myScore = b?.myScore ?? this.record.myScore;
      this.record.oppScore = b?.oppScore ?? this.record.oppScore;
      this.record.winner =
        (b?.myScore ?? 0) > (b?.oppScore ?? 0) ? 'me' : 'opponent';
      this.record.matText = matText;
      await this.snapshot();
      await this.persist();
    }
    const b2 = this.board;
    this.update({
      phase: 'matchOver',
      banner:
        this.matchEndText ??
        (b2
          ? `Match over: You ${b2.myScore} — ${b2.oppScore} gnubg`
          : 'Match over'),
      thinking: false,
    });
  }

  private async persist() {
    if (!this.record) return;
    const b = this.board;
    if (b) {
      this.record.myScore = b.myScore;
      this.record.oppScore = b.oppScore;
    }
    try {
      await saveMatch(this.record);
    } catch (e) {
      console.debug('persist failed', e);
    }
  }

  private pushDecision(d: Decision) {
    if (!this.record) return;
    this.record.decisions.push(d);
    void this.persist();
  }

  addHop(hop: CheckerHop) {
    const next = [...this.state.pendingHops, hop];
    this.update({
      pendingHops: next,
      canCommit: isComplete(this.state.legal, next),
    });
  }

  undoHops() {
    const next = this.state.pendingHops.slice(0, -1);
    this.update({
      pendingHops: next,
      canCommit: isComplete(this.state.legal, next),
    });
  }

  continuationsNow(): CheckerHop[] {
    return continuations(this.state.legal, this.state.pendingHops);
  }

  async commitMove() {
    const b = this.boardAtDecision;
    const hops = this.state.pendingHops;
    if (!b || !isComplete(this.state.legal, hops)) return;
    // Keep the pending-move preview on the board; it's cleared when the engine
    // emits the post-move board (see onEngineEvent), avoiding a pre-move flash.
    this.update({ thinking: true, phase: 'aiTurn', legal: [] });
    const hints = this.moveHintPromise ? await this.moveHintPromise : [];
    const playedHint =
      hints.find((h) =>
        sameCheckerPlay(b.points, parseMoveString(h.move), hops),
      ) ?? null;
    this.pushDecision(
      buildCheckerDecision(
        b,
        hints,
        playedHint,
        hopsToMoveCommand(hops),
        this.gameNo,
        this.record?.decisions.length ?? 0,
      ),
    );
    const out = await this.act('move ' + hopsToMoveCommand(hops));
    if (out.some((l) => /illegal|not legal|invalid/i.test(l))) {
      this.update({ error: 'Engine rejected move: ' + out.join(' ') });
    }
    // Let the human's completed move sit on the board a beat before gnubg plays.
    await sleep(PAUSE_AFTER_MOVE_MS);
    await this.settle();
  }

  private async recordCubeOffer(action: 'roll' | 'double') {
    const b = this.boardAtDecision;
    const hint = this.cubeHintPromise ? await this.cubeHintPromise : null;
    this.cubeHintPromise = null;
    if (b && hint && hint.options.length > 0) {
      this.pushDecision({
        kind: 'cube',
        sub: 'offer',
        gameNo: this.gameNo,
        moveNo: this.record?.decisions.length ?? 0,
        snapshot: b,
        hint,
        action,
        proper: hint.proper,
        loss: cubeOfferLoss(hint, action),
      });
    }
  }

  async roll() {
    if (this.state.phase !== 'awaitRoll') return;
    this.update({ thinking: true });
    if (this.state.canDouble) await this.recordCubeOffer('roll');
    await this.act('roll');
    await this.settle();
  }

  async double() {
    if (this.state.phase !== 'awaitRoll' || !this.state.canDouble) return;
    this.update({ thinking: true });
    await this.recordCubeOffer('double');
    this.humanDoubled = true;
    await this.act('double');
    await this.settle();
  }

  private async recordCubeResponse(action: 'take' | 'pass') {
    const b = this.boardAtDecision;
    const hint = this.responseHintPromise ? await this.responseHintPromise : null;
    this.responseHintPromise = null;
    if (b && hint && hint.options.length > 0) {
      this.pushDecision({
        kind: 'cube',
        sub: 'response',
        gameNo: this.gameNo,
        moveNo: this.record?.decisions.length ?? 0,
        snapshot: b,
        hint,
        action,
        proper: hint.proper,
        loss: cubeResponseLoss(hint, action),
      });
    }
  }

  async take() {
    if (this.state.phase !== 'doubleOffered') return;
    this.update({ thinking: true });
    await this.recordCubeResponse('take');
    await this.act('take');
    await this.settle();
  }

  async pass() {
    if (this.state.phase !== 'doubleOffered') return;
    this.update({ thinking: true });
    await this.recordCubeResponse('pass');
    await this.act('drop');
    await this.settle();
  }

  async acceptResign() {
    if (this.state.phase !== 'resignOffered') return;
    this.resignOffered = 0;
    this.update({ thinking: true, resignValue: 0 });
    await this.act('accept');
    await this.settle();
  }

  async declineResign() {
    if (this.state.phase !== 'resignOffered') return;
    this.resignOffered = 0;
    this.update({ thinking: true, resignValue: 0 });
    await this.act('reject');
    await this.settle();
  }

  async resign(value: 1 | 2 | 3) {
    const name = value === 1 ? 'single' : value === 2 ? 'gammon' : 'backgammon';
    this.update({ thinking: true });
    await this.act(`resign ${name}`);
    await this.settle();
  }

  async exportMat(): Promise<string | null> {
    try {
      await this.engine.command('export match mat "/current.mat"');
      const text = await this.engine.readFile('/current.mat');
      if (this.record) {
        this.record.matText = text;
        await this.persist();
      }
      return text;
    } catch (e) {
      console.debug('mat export failed', e);
      return null;
    }
  }
}

let shared: Session | null = null;
export function getSession(): Session {
  if (!shared) shared = new Session();
  return shared;
}
