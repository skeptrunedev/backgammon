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
      this.update({ board: ev.state });
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

  async newMatch(length: number, aiPlies: number) {
    if (!this.state.engineReady) return;
    this.gameNo = 1;
    this.lastScoreKey = '0:0';
    this.gameEndText = null;
    this.matchEndText = null;
    this.resignOffered = 0;
    this.board = null;
    this.record = {
      id: crypto.randomUUID(),
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
    };
    this.update({
      matchId: this.record.id,
      banner: null,
      error: null,
      pendingHops: [],
      legal: [],
      thinking: true,
    });
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
    await this.act(`new match ${length}`);
    await this.engine.command('set player 1 name You');
    await this.settle();
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
        if (b.wasDoubled) {
          this.boardAtDecision = b;
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
          if (quiet > 20) {
            this.update({ thinking: false, error: 'Engine stalled — try a new match.' });
            return;
          }
        } else {
          quiet = 0;
          await sleep(200);
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
    this.update({ pendingHops: [], canCommit: false });
  }

  continuationsNow(): CheckerHop[] {
    return continuations(this.state.legal, this.state.pendingHops);
  }

  async commitMove() {
    const b = this.boardAtDecision;
    const hops = this.state.pendingHops;
    if (!b || !isComplete(this.state.legal, hops)) return;
    this.update({ thinking: true, phase: 'aiTurn', pendingHops: [], legal: [] });
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
