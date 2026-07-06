import { useId, useRef, useLayoutEffect } from 'react';
import type { BoardState, CheckerHop } from '../engine/types';
import { BAR, OFF } from '../engine/types';
import { applyHopsToPoints } from '../engine/parse';
import { dieUsage, deadDice } from '../game/rules';

// Checker sprites (top-down glossy wooden discs, transparent bg). Drawn as
// <image> at 2R so they stay crisp at any board size / mobile scale.
const CHECKER_LIGHT = '/sprites/checker-light.png';
const CHECKER_DARK = '/sprites/checker-dark.png';
// Surface textures, filled via SVG patterns over the existing board shapes so
// the responsive geometry (and click zones) are unchanged. One image stretched
// across the whole board in user space — no tiling seams, works for any aspect.
const WOOD = '/sprites/wood-dark.jpg';
const FELT = '/sprites/felt.jpg';
// Blank wooden die faces; pips are drawn as SVG on top so counts are exact.
const DIE_LIGHT = '/sprites/die-light.png';
const DIE_DARK = '/sprites/die-dark.png';

/**
 * Board geometry. Two modes:
 *  - `default` (1320×960, ratio ≈ 1.375): desktop, portrait, and the analysis
 *    mini board. Unchanged from the original layout.
 *  - `wide` (ratio ≈ 2.2): a landscape-phone layout. A shorter, wider board so
 *    it can fill the full width of a ~2.16:1 phone viewport without vertical
 *    overflow — and without distorting checkers (they stay circular; the board
 *    is genuinely re-proportioned, not stretched).
 *
 * Every derived value flows from these inputs, so both modes reflow correctly.
 */
export interface BoardGeom {
  W: number;
  H: number;
  FRAME: number;
  TRAY_W: number;
  BAR_W: number;
  COL_W: number;
  R: number;
  POINT_H: number;
  boardLeft: number;
  barLeft: number;
  barRight: number;
  trayLeft: number;
}

function geom(wide: boolean): BoardGeom {
  // `wide` (landscape phone): a wider ~2:1 board so it fills the phone's width,
  // with large checkers (they overlap when stacked — see STACK_STEP — so a tall
  // board isn't required) and long points. Desktop keeps the classic ~1.375.
  const W = wide ? 1640 : 1320;
  const H = wide ? 820 : 960;
  const FRAME = wide ? 22 : 24;
  const TRAY_W = wide ? 100 : 90;
  const BAR_W = wide ? 86 : 84;
  const COL_W = (W - FRAME * 2 - TRAY_W - BAR_W) / 12;
  const R = Math.min(COL_W / 2 - 6, wide ? 52 : 40);
  // Long points: tips leave only a small central gap (like the reference board).
  const POINT_H = wide ? 300 : 340;
  const boardLeft = FRAME;
  const barLeft = boardLeft + COL_W * 6;
  const barRight = barLeft + BAR_W;
  const trayLeft = W - FRAME - TRAY_W;
  return { W, H, FRAME, TRAY_W, BAR_W, COL_W, R, POINT_H, boardLeft, barLeft, barRight, trayLeft };
}

const DEFAULT_GEOM = geom(false);
const WIDE_GEOM = geom(true);

/**
 * Layout metrics needed by callers positioning HTML overlays in board space.
 * These are mode-dependent, so PlayScreen must read the metrics for the mode
 * it is currently rendering.
 */
export interface BoardMetrics {
  /** Board intrinsic dimensions (viewBox units). */
  w: number;
  h: number;
  /** Horizontal center of the player's dice cluster, as a % of board width. */
  diceCenterXPct: number;
  /** Anchor just below the dice (dice span H/2±30), as a % of board height. */
  belowDiceYPct: number;
}

function metricsOf(g: BoardGeom): BoardMetrics {
  return {
    w: g.W,
    h: g.H,
    diceCenterXPct: (((g.barRight + g.trayLeft) / 2) / g.W) * 100,
    belowDiceYPct: ((g.H / 2 + 50) / g.H) * 100,
  };
}

/** Metrics for the active board mode (`wide` = landscape-phone layout). */
export function boardMetrics(wide = false): BoardMetrics {
  return metricsOf(wide ? WIDE_GEOM : DEFAULT_GEOM);
}

// Default-mode exports (backwards compatible with the original API).
const DEFAULT_METRICS = metricsOf(DEFAULT_GEOM);
export const BOARD_W = DEFAULT_METRICS.w;
export const BOARD_H = DEFAULT_METRICS.h;
export const DICE_CENTER_X_PCT = DEFAULT_METRICS.diceCenterXPct;
export const BELOW_DICE_Y_PCT = DEFAULT_METRICS.belowDiceYPct;

function pointX(g: BoardGeom, p: number): number {
  if (p >= 1 && p <= 6) return g.barRight + (6 - p) * g.COL_W;
  if (p >= 7 && p <= 12) return g.boardLeft + (12 - p) * g.COL_W;
  if (p >= 13 && p <= 18) return g.boardLeft + (p - 13) * g.COL_W;
  return g.barRight + (p - 19) * g.COL_W;
}

function pointIsTop(p: number): boolean {
  return p >= 13;
}

interface Props {
  board: BoardState;
  pendingHops?: CheckerHop[];
  sources?: number[];
  dests?: number[];
  onPointClick?: (p: number) => void;
  showDice?: boolean;
  mini?: boolean;
  /** Fill the parent box exactly (parent is sized to the board's aspect). */
  fill?: boolean;
  /** Landscape-phone layout: a shorter, wider board (see `geom`). */
  wide?: boolean;
  /** Index of the player's die that will be tried first on a click. */
  activeDie?: number;
  onDieClick?: (i: number) => void;
}

export default function Board({
  board,
  pendingHops = [],
  sources = [],
  dests = [],
  onPointClick,
  showDice = true,
  mini = false,
  fill = false,
  wide = false,
  activeDie = 0,
  onDieClick,
}: Props) {
  const g = wide ? WIDE_GEOM : DEFAULT_GEOM;
  const { W, H, FRAME, TRAY_W, BAR_W, COL_W, R, POINT_H, boardLeft, barLeft, barRight, trayLeft } = g;
  const uid = useId().replace(/:/g, '');
  const woodFill = `url(#wood-${uid})`;
  const feltFill = `url(#felt-${uid})`;
  const prevCheckersRef = useRef<{ mine: boolean; cx: number; cy: number; key: string }[]>([]);
  const keyCtrRef = useRef(0);
  // Vertical step between stacked checkers. Normally a full diameter (just
  // touching), but tightened so 5 checkers always fit within a half-board —
  // needed on the wide board where big checkers would otherwise overflow.
  const STACK_STEP = Math.min(R * 2 - 2, (H / 2 - FRAME - 2 * R - 4) / 4);
  const points = applyHopsToPoints(board.points, pendingHops);
  const pendingOff = pendingHops.filter((h) => h.to === OFF).length;
  const myOff = board.myOff + pendingOff;

  const clickable = (p: number) =>
    !!onPointClick && (sources.includes(p) || dests.includes(p));

  const renderPoint = (p: number) => {
    const x = pointX(g, p);
    const top = pointIsTop(p);
    const baseY = top ? FRAME : H - FRAME;
    const tipY = top ? FRAME + POINT_H : H - FRAME - POINT_H;
    const fill = p % 2 === 0 ? 'var(--pt-a)' : 'var(--pt-b)';
    return (
      <g key={p}>
        <polygon
          points={`${x + 2},${baseY} ${x + COL_W - 2},${baseY} ${x + COL_W / 2},${tipY}`}
          fill={fill}
          opacity={0.95}
        />
        {!mini && (
          <text x={x + COL_W / 2} y={top ? FRAME - 6 : H - FRAME + 16} className="pt-label" textAnchor="middle">
            {p}
          </text>
        )}
        {/* Full-column hit target: the checker layer above is pointer-events:none,
            so taps on a checker fall through to here. Covers the whole stack, not
            just the triangle. */}
        {onPointClick && (
          <rect
            x={x}
            y={top ? FRAME : H / 2}
            width={COL_W}
            height={H / 2 - FRAME}
            fill="transparent"
            pointerEvents="all"
            onClick={() => clickable(p) && onPointClick(p)}
            style={{ cursor: clickable(p) ? 'pointer' : 'default' }}
          />
        )}
      </g>
    );
  };

  // All checkers as a flat list ({mine, cx, cy}) plus overflow-count labels.
  // Rendered as one keyed, position-matched layer so each checker keeps its
  // identity across board changes and CSS-slides to its new spot.
  const rawCheckers: { mine: boolean; cx: number; cy: number }[] = [];
  const counts: { mine: boolean; cx: number; cy: number; n: number }[] = [];
  for (let p = 1; p <= 24; p++) {
    const v = points[p];
    if (v === 0) continue;
    const n = Math.abs(v);
    const mine = v > 0;
    const top = pointIsTop(p);
    const cx = pointX(g, p) + COL_W / 2;
    for (let i = 0; i < Math.min(n, 5); i++) {
      const cy = top ? FRAME + R + 4 + i * STACK_STEP : H - FRAME - R - 4 - i * STACK_STEP;
      rawCheckers.push({ mine, cx, cy });
    }
    if (n > 5) {
      const cy = top ? FRAME + R + 4 + 4 * STACK_STEP : H - FRAME - R - 4 - 4 * STACK_STEP;
      counts.push({ mine, cx, cy: cy + 8, n });
    }
  }
  {
    const cx = barLeft + BAR_W / 2;
    const barGap = R + 16;
    const myBar = points[BAR];
    const oppBar = -points[0];
    for (let i = 0; i < Math.min(myBar, 4); i++) rawCheckers.push({ mine: true, cx, cy: H / 2 + barGap + i * STACK_STEP });
    if (myBar > 4) counts.push({ mine: true, cx, cy: H / 2 + barGap + 8, n: myBar });
    for (let i = 0; i < Math.min(oppBar, 4); i++) rawCheckers.push({ mine: false, cx, cy: H / 2 - barGap - i * STACK_STEP });
    if (oppBar > 4) counts.push({ mine: false, cx, cy: H / 2 - barGap + 8, n: oppBar });
  }

  // Match each checker to its nearest previous same-color position (globally,
  // closest pairs first) so a moved checker carries its key and slides.
  const prev = prevCheckersRef.current;
  const pairs: { i: number; j: number; d: number }[] = [];
  rawCheckers.forEach((c, i) => {
    prev.forEach((pc, j) => {
      if (pc.mine !== c.mine) return;
      pairs.push({ i, j, d: (pc.cx - c.cx) ** 2 + (pc.cy - c.cy) ** 2 });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const keyForNew: (string | undefined)[] = new Array(rawCheckers.length);
  const usedPrev = new Set<number>();
  for (const { i, j } of pairs) {
    if (keyForNew[i] !== undefined || usedPrev.has(j)) continue;
    keyForNew[i] = prev[j].key;
    usedPrev.add(j);
  }
  const checkers = rawCheckers.map((c, i) => ({
    ...c,
    key: keyForNew[i] ?? `ck${keyCtrRef.current++}`,
  }));
  useLayoutEffect(() => {
    prevCheckersRef.current = checkers;
  });
  // Render in a STABLE order by key (not board-point order). If the list were
  // ordered by position, a checker that moves would be re-inserted elsewhere in
  // the SVG child list; re-inserting a node during the same commit that changes
  // its transform drops the CSS-transition baseline, so it snaps to the new
  // spot instead of sliding. Keeping each key in a fixed slot means React only
  // patches the transform attribute in place, so the transition always plays.
  const orderedCheckers = [...checkers].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const renderBar = () => (
    <g
      onClick={() => onPointClick && sources.includes(BAR) && onPointClick(BAR)}
      style={{ cursor: onPointClick && sources.includes(BAR) ? 'pointer' : 'default' }}
    >
      <rect x={barLeft} y={FRAME} width={BAR_W} height={H - FRAME * 2} fill={woodFill} />
    </g>
  );

  const renderTray = () => {
    const offDest = dests.includes(OFF);
    return (
      <g
        onClick={() => onPointClick && offDest && onPointClick(OFF)}
        style={{ cursor: onPointClick && offDest ? 'pointer' : 'default' }}
      >
        <rect x={trayLeft} y={FRAME} width={TRAY_W} height={H - FRAME * 2} fill={woodFill} />
        {Array.from({ length: Math.min(board.oppOff, 15) }, (_, i) => (
          <rect key={`oo${i}`} x={trayLeft + 12} y={FRAME + 10 + i * 22} width={TRAY_W - 24} height={16} rx={4} className="off-opp" />
        ))}
        {Array.from({ length: Math.min(myOff, 15) }, (_, i) => (
          <rect key={`mo${i}`} x={trayLeft + 12} y={H - FRAME - 26 - i * 22} width={TRAY_W - 24} height={16} rx={4} className="off-me" />
        ))}
      </g>
    );
  };

  const renderDice = () => {
    if (!showDice || board.dice[0] === 0) return null;
    const mine = board.turn === 1;
    const cx = mine ? (barRight + trayLeft) / 2 : (boardLeft + barLeft) / 2;
    const usage = mine ? dieUsage(board.dice, pendingHops) : [0, 0];
    const dead = mine ? deadDice(board.points, board.dice) : [false, false];
    const isDouble = board.dice[0] === board.dice[1];
    const interactive = mine && !!onDieClick && !isDouble;
    // Render the leading die in the left slot so clicking to reorder visibly
    // swaps the dice horizontally — no separate highlight needed.
    const order = mine && activeDie === 1 ? [1, 0] : [0, 1];
    // Re-key by the roll so the appear animation replays on every new roll,
    // but not when only the used-overlay changes (playing a checker).
    const rollKey = `${board.turn}-${board.dice[0]}-${board.dice[1]}`;
    return (
      <g>
        {order.map((di, slot) => {
          const consumed = isDouble ? usage[di] / 2 : usage[di];
          const frac = dead[di] ? 1 : consumed;
          return (
            <g
              key={di}
              transform={`translate(${cx - 70 + slot * 80}, ${H / 2 - 30})`}
              onClick={() => interactive && !dead[di] && onDieClick!(di)}
              style={{ cursor: interactive && !dead[di] ? 'pointer' : 'default' }}
            >
              <g key={rollKey} className="die-in">
                <image href={mine ? DIE_LIGHT : DIE_DARK} x={0} y={0} width={60} height={60} />
                {diePips(board.dice[di], mine)}
                {frac > 0 && (
                  <rect
                    width={60}
                    height={60 * frac}
                    y={60 - 60 * frac}
                    rx={12}
                    className="die-used"
                  />
                )}
              </g>
            </g>
          );
        })}
      </g>
    );
  };

  const renderCube = () => {
    // The cube is out of play during the Crawford game.
    if (board.crawford) return null;
    const centered = board.iMayDouble && board.oppMayDouble;
    const CUBE = 64;
    // The cube lives on the bar, but must never overlap checkers there. Compute
    // the clear space above the opponent's bar stack and below mine, and place
    // the cube in whichever clear zone suits its owner (me = bottom, opp = top),
    // falling back to the roomier zone. Centered rests in the middle only when
    // the bar is empty.
    const myBar = points[BAR];
    const oppBar = -points[0];
    const barGap = R + 16;
    const oppStackTop = oppBar > 0 ? H / 2 - barGap - (Math.min(oppBar, 4) - 1) * STACK_STEP - R : H / 2;
    const myStackBottom = myBar > 0 ? H / 2 + barGap + (Math.min(myBar, 4) - 1) * STACK_STEP + R : H / 2;
    const topSpace = oppStackTop - FRAME;
    const bottomSpace = H - FRAME - myStackBottom;
    const topCenter = FRAME + topSpace / 2;
    const bottomCenter = H - FRAME - bottomSpace / 2;
    const fits = (space: number) => space >= CUBE + 8;
    let cy: number;
    if (centered) {
      // At rest: the middle when the bar is empty, else the roomier clear zone.
      cy = myBar === 0 && oppBar === 0 ? H / 2 : topSpace >= bottomSpace ? topCenter : bottomCenter;
    } else if (board.iMayDouble) {
      // I own it → my side (bottom), unless my bar stack crowds it out.
      cy = fits(bottomSpace) ? bottomCenter : topCenter;
    } else {
      // gnubg owns it → its side (top), unless its bar stack crowds it out.
      cy = fits(topSpace) ? topCenter : bottomCenter;
    }
    cy = Math.max(FRAME + CUBE / 2, Math.min(H - FRAME - CUBE / 2, cy));
    const x = barLeft + BAR_W / 2 - CUBE / 2;
    const y = cy - CUBE / 2;
    return (
      <g transform={`translate(${x}, ${y})`}>
        <rect width={CUBE} height={CUBE} rx={10} className="cube" />
        <text x={CUBE / 2} y={CUBE / 2 + 10} textAnchor="middle" className="cube-text">
          {board.cubeValue === 1 ? 64 : board.cubeValue}
        </text>
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={mini ? 'board mini' : fill ? 'board fill' : 'board'}
      role="img"
      aria-label="backgammon board"
    >
      <defs>
        <pattern id={`wood-${uid}`} patternUnits="userSpaceOnUse" width={W} height={H}>
          <image href={WOOD} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />
        </pattern>
        <pattern id={`felt-${uid}`} patternUnits="userSpaceOnUse" width={W} height={H}>
          <image href={FELT} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={W} height={H} rx={18} fill={woodFill} />
      <rect x={boardLeft} y={FRAME} width={barLeft - boardLeft} height={H - FRAME * 2} fill={feltFill} />
      <rect x={barRight} y={FRAME} width={trayLeft - barRight} height={H - FRAME * 2} fill={feltFill} />
      {Array.from({ length: 24 }, (_, i) => renderPoint(i + 1))}
      {renderBar()}
      {renderTray()}
      {orderedCheckers.map((c) => (
        <g key={c.key} className="checker-slide" transform={`translate(${c.cx}, ${c.cy})`}>
          <image href={c.mine ? CHECKER_LIGHT : CHECKER_DARK} x={-R} y={-R} width={R * 2} height={R * 2} />
        </g>
      ))}
      {counts.map((ct, i) => (
        <text key={`cnt${i}`} x={ct.cx} y={ct.cy} textAnchor="middle" pointerEvents="none" className={ct.mine ? 'count-me' : 'count-opp'}>
          {ct.n}
        </text>
      ))}
      {renderDice()}
      {renderCube()}
    </svg>
  );
}

function diePips(v: number, onLightDie: boolean) {
  const pos: Record<number, [number, number][]> = {
    1: [[30, 30]],
    2: [[16, 16], [44, 44]],
    3: [[16, 16], [30, 30], [44, 44]],
    4: [[16, 16], [44, 16], [16, 44], [44, 44]],
    5: [[16, 16], [44, 16], [30, 30], [16, 44], [44, 44]],
    6: [[16, 14], [44, 14], [16, 30], [44, 30], [16, 46], [44, 46]],
  };
  // Dark pips on the cream die, cream pips on the dark die.
  const fill = onLightDie ? 'oklch(0.26 0.02 55)' : 'oklch(0.92 0.02 90)';
  return (pos[v] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5.5} fill={fill} />);
}
