import type { BoardState, CheckerHop } from '../engine/types';
import { BAR, OFF } from '../engine/types';
import { applyHopsToPoints } from '../engine/parse';
import { dieUsage, deadDice } from '../game/rules';

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
  const W = wide ? 1640 : 1320;
  const H = wide ? 744 : 960;
  const FRAME = 24;
  const TRAY_W = wide ? 96 : 90;
  const BAR_W = wide ? 90 : 84;
  const COL_W = (W - FRAME * 2 - TRAY_W - BAR_W) / 12;
  // Cap the checker radius smaller in wide mode: a shorter board means a
  // 5-checker stack must fit in less vertical room. 5 stacked checkers span
  // ~10R, which must stay within a half-board (H/2 − FRAME).
  const R = Math.min(COL_W / 2 - 4, wide ? 33 : 40);
  const POINT_H = wide ? 262 : 340;
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
      <g key={p} onClick={() => clickable(p) && onPointClick!(p)} style={{ cursor: clickable(p) ? 'pointer' : 'default' }}>
        <polygon
          points={`${x + 2},${baseY} ${x + COL_W - 2},${baseY} ${x + COL_W / 2},${tipY}`}
          fill={fill}
          opacity={0.95}
        />
        {renderCheckers(p, points[p], top, x)}
        {!mini && (
          <text x={x + COL_W / 2} y={top ? FRAME - 6 : H - FRAME + 16} className="pt-label" textAnchor="middle">
            {p}
          </text>
        )}
      </g>
    );
  };

  const renderCheckers = (key: number, v: number, top: boolean, x: number) => {
    if (v === 0) return null;
    const n = Math.abs(v);
    const mine = v > 0;
    const shown = Math.min(n, 5);
    const cx = x + COL_W / 2;
    const items = [];
    for (let i = 0; i < shown; i++) {
      const cy = top ? FRAME + R + 4 + i * (R * 2 - 2) : H - FRAME - R - 4 - i * (R * 2 - 2);
      items.push(
        <circle key={`${key}-${i}`} cx={cx} cy={cy} r={R} className={mine ? 'checker-me' : 'checker-opp'} />,
      );
    }
    if (n > 5) {
      const cy = top ? FRAME + R + 4 + 4 * (R * 2 - 2) : H - FRAME - R - 4 - 4 * (R * 2 - 2);
      items.push(
        <text key={`${key}-n`} x={cx} y={cy + 8} textAnchor="middle" className={mine ? 'count-me' : 'count-opp'}>
          {n}
        </text>,
      );
    }
    return items;
  };

  const renderBar = () => {
    const cx = barLeft + BAR_W / 2;
    const items = [];
    const myBar = points[BAR];
    const oppBar = -points[0];
    for (let i = 0; i < Math.min(myBar, 4); i++) {
      items.push(<circle key={`mb${i}`} cx={cx} cy={H / 2 + 60 + i * (R * 2 - 6)} r={R} className="checker-me" />);
    }
    if (myBar > 4) items.push(<text key="mbn" x={cx} y={H / 2 + 68} textAnchor="middle" className="count-me">{myBar}</text>);
    for (let i = 0; i < Math.min(oppBar, 4); i++) {
      items.push(<circle key={`ob${i}`} cx={cx} cy={H / 2 - 60 - i * (R * 2 - 6)} r={R} className="checker-opp" />);
    }
    if (oppBar > 4) items.push(<text key="obn" x={cx} y={H / 2 - 52} textAnchor="middle" className="count-opp">{oppBar}</text>);
    return (
      <g
        onClick={() => onPointClick && sources.includes(BAR) && onPointClick(BAR)}
        style={{ cursor: onPointClick && sources.includes(BAR) ? 'pointer' : 'default' }}
      >
        <rect x={barLeft} y={FRAME} width={BAR_W} height={H - FRAME * 2} fill="var(--bar)" />
        {items}
      </g>
    );
  };

  const renderTray = () => {
    const offDest = dests.includes(OFF);
    return (
      <g
        onClick={() => onPointClick && offDest && onPointClick(OFF)}
        style={{ cursor: onPointClick && offDest ? 'pointer' : 'default' }}
      >
        <rect x={trayLeft} y={FRAME} width={TRAY_W} height={H - FRAME * 2} fill="var(--tray)" />
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
              <rect width={60} height={60} rx={12} className={mine ? 'die-me' : 'die-opp'} />
              {diePips(board.dice[di])}
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
          );
        })}
      </g>
    );
  };

  const renderCube = () => {
    // The cube is out of play during the Crawford game.
    if (board.crawford) return null;
    const centered = board.iMayDouble && board.oppMayDouble;
    // The cube lives on the bar (the central rail): resting in the middle when
    // neither owns it, sliding to the owner's end once it's held (me = bottom,
    // opponent = top).
    const x = barLeft + BAR_W / 2 - 32;
    const y = centered ? H / 2 - 32 : board.iMayDouble ? H - FRAME - 72 : FRAME + 8;
    return (
      <g transform={`translate(${x}, ${y})`}>
        <rect width={64} height={64} rx={10} className="cube" />
        <text x={32} y={42} textAnchor="middle" className="cube-text">
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
      <rect x={0} y={0} width={W} height={H} rx={18} fill="var(--frame)" />
      <rect x={boardLeft} y={FRAME} width={barLeft - boardLeft} height={H - FRAME * 2} fill="var(--felt)" />
      <rect x={barRight} y={FRAME} width={trayLeft - barRight} height={H - FRAME * 2} fill="var(--felt)" />
      {Array.from({ length: 24 }, (_, i) => renderPoint(i + 1))}
      {renderBar()}
      {renderTray()}
      {renderDice()}
      {renderCube()}
    </svg>
  );
}

function diePips(v: number) {
  const pos: Record<number, [number, number][]> = {
    1: [[30, 30]],
    2: [[16, 16], [44, 44]],
    3: [[16, 16], [30, 30], [44, 44]],
    4: [[16, 16], [44, 16], [16, 44], [44, 44]],
    5: [[16, 16], [44, 16], [30, 30], [16, 44], [44, 44]],
    6: [[16, 14], [44, 14], [16, 30], [44, 30], [16, 46], [44, 46]],
  };
  return (pos[v] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5.5} className="die-pip" />);
}
