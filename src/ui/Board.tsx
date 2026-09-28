import type { ReactNode } from 'react';
import Svg, { Rect, Polygon, Circle, G, Image as SvgImage, Text as SvgText } from 'react-native-svg';
import type { BoardState, CheckerHop } from '../engine/types';
import { BAR } from '../engine/types';
import { applyHopsToPoints } from '../engine/parse';
import { dieUsage, deadDice } from '../game/rules';

// Sprites (same assets as the web app) so the board reads identically.
const WOOD = require('../../assets/sprites/wood-dark.jpg');
const FELT = require('../../assets/sprites/felt.jpg');
const CHECKER_LIGHT = require('../../assets/sprites/checker-light.png');
const CHECKER_DARK = require('../../assets/sprites/checker-dark.png');
const DIE_LIGHT = require('../../assets/sprites/die-light.png');
const DIE_DARK = require('../../assets/sprites/die-dark.png');

/**
 * Board geometry, ported from the web board. Two modes:
 *  - `default` (1320×960, ratio ≈ 1.375): tablets and other roomy screens.
 *  - `wide` (820 tall, 1.6:1 to 2.4:1): landscape phones. A shorter, wider board
 *    whose width follows the screen's aspect so it fills the full width;
 *    checkers stay circular because the board is re-proportioned, not
 *    stretched.
 */
interface BoardGeom {
  W: number;
  H: number;
  FRAME: number;
  TRAY_W: number;
  BAR_W: number;
  COL_W: number;
  R: number;
  POINT_H: number;
  STACK_STEP: number;
  boardLeft: number;
  barLeft: number;
  barRight: number;
  trayLeft: number;
}

function geom(wide: boolean, aspect = 2): BoardGeom {
  const W = wide ? Math.round(820 * Math.min(Math.max(aspect, 1.6), 2.4)) : 1320;
  const H = wide ? 820 : 960;
  const FRAME = wide ? 22 : 24;
  const TRAY_W = wide ? 100 : 90;
  const BAR_W = wide ? 86 : 84;
  const COL_W = (W - FRAME * 2 - TRAY_W - BAR_W) / 12;
  const R = Math.min(COL_W / 2 - 6, wide ? 52 : 40);
  const POINT_H = wide ? 300 : 340;
  // Checkers overlap when stacked so a stack of five fits half the board.
  const STACK_STEP = Math.min(R * 2 - 2, (H / 2 - FRAME - 2 * R - 4) / 4);
  const boardLeft = FRAME;
  const barLeft = boardLeft + COL_W * 6;
  const barRight = barLeft + BAR_W;
  const trayLeft = W - FRAME - TRAY_W;
  return { W, H, FRAME, TRAY_W, BAR_W, COL_W, R, POINT_H, STACK_STEP, boardLeft, barLeft, barRight, trayLeft };
}

const DEFAULT_GEOM = geom(false);

/** Layout metrics callers need to size the board and place overlays on it. */
export interface BoardMetrics {
  /** Board intrinsic dimensions (viewBox units). */
  w: number;
  h: number;
  /** Horizontal center of the player's dice, as a fraction of board width. */
  diceCenterX: number;
  /** Anchor just below the dice (dice span H/2±30), as a fraction of board height. */
  belowDiceY: number;
}

/** `aspect` is the width/height the board should fill (wide mode only). */
export function boardMetrics(wide = false, aspect = 2): BoardMetrics {
  const g = wide ? geom(true, aspect) : DEFAULT_GEOM;
  return {
    w: g.W,
    h: g.H,
    diceCenterX: (g.barRight + g.trayLeft) / 2 / g.W,
    belowDiceY: (g.H / 2 + 50) / g.H,
  };
}

// Palette (web CSS vars converted from oklch to sRGB).
const C = {
  ptA: '#a98d5e', // muted tan points
  ptB: '#473829', // dark brown points
  label: 'rgba(237,229,209,0.42)',
  wellTop: '#241f16',
  wellBot: '#342d21',
  cube: '#e7d9ad',
  cubeStroke: 'rgba(90,76,50,0.65)',
  cubeText: '#332e1c',
  countMe: '#2c291b',
  countOpp: '#ece4d0',
  pipLight: '#3f3828', // pips on the cream die
  pipDark: '#ece4d0', // pips on the dark die
  dieUsed: 'rgba(28,24,20,0.72)', // consumed portion of a die
};

function pointX(g: BoardGeom, p: number): number {
  if (p >= 1 && p <= 6) return g.barRight + (6 - p) * g.COL_W;
  if (p >= 7 && p <= 12) return g.boardLeft + (12 - p) * g.COL_W;
  if (p >= 13 && p <= 18) return g.boardLeft + (p - 13) * g.COL_W;
  return g.barRight + (p - 19) * g.COL_W;
}
const isTop = (p: number) => p >= 13;

const PIPS: Record<number, [number, number][]> = {
  1: [[30, 30]],
  2: [[16, 16], [44, 44]],
  3: [[16, 16], [30, 30], [44, 44]],
  4: [[16, 16], [44, 16], [16, 44], [44, 44]],
  5: [[16, 16], [44, 16], [30, 30], [16, 44], [44, 44]],
  6: [[16, 16], [44, 16], [16, 30], [44, 30], [16, 44], [44, 44]],
};

function Die({ x, y, value, mine, used, onPress }: { x: number; y: number; value: number; mine: boolean; used: number; onPress?: () => void }) {
  return (
    <G x={x} y={y} onPress={onPress}>
      <SvgImage href={mine ? DIE_LIGHT : DIE_DARK} x={0} y={0} width={60} height={60} preserveAspectRatio="xMidYMid meet" />
      {(PIPS[value] ?? []).map(([px, py], i) => (
        <Circle key={i} cx={px} cy={py} r={5.5} fill={mine ? C.pipLight : C.pipDark} />
      ))}
      {used > 0 && <Rect width={60} height={60 * used} y={60 - 60 * used} rx={12} fill={C.dieUsed} />}
    </G>
  );
}

export function Board({
  board,
  pendingHops = [],
  sources = [],
  onPointClick,
  activeDie = 0,
  onDieClick,
  wide = false,
  aspect = 2,
}: {
  board: BoardState;
  pendingHops?: CheckerHop[];
  sources?: number[];
  onPointClick?: (p: number) => void;
  /** Which of the player's dice is played first; it's drawn in the left slot. */
  activeDie?: number;
  /** Tapping one of the player's dice flips which die is played first. */
  onDieClick?: (i: number) => void;
  /** Landscape-phone layout: a shorter, wider board (see `geom`). */
  wide?: boolean;
  /** Width/height of the space the wide board fills. */
  aspect?: number;
}) {
  const g = wide ? geom(true, aspect) : DEFAULT_GEOM;
  const { W, H, FRAME, TRAY_W, BAR_W, COL_W, R, POINT_H, STACK_STEP, boardLeft, barLeft, barRight, trayLeft } = g;

  // Show the in-progress move as a preview (same as the web board).
  const pts = applyHopsToPoints(board.points, pendingHops);

  // Checkers per point (sprites, stacked, overflow count).
  const checkers: ReactNode[] = [];
  const counts: ReactNode[] = [];
  for (let p = 1; p <= 24; p++) {
    const v = pts[p];
    if (!v) continue;
    const mine = v > 0;
    const n = Math.abs(v);
    const top = isTop(p);
    const cx = pointX(g, p) + COL_W / 2;
    for (let i = 0; i < Math.min(n, 5); i++) {
      const cy = top ? FRAME + R + 4 + i * STACK_STEP : H - FRAME - R - 4 - i * STACK_STEP;
      checkers.push(
        <SvgImage
          key={`c${p}-${i}`}
          href={mine ? CHECKER_LIGHT : CHECKER_DARK}
          x={cx - R}
          y={cy - R}
          width={R * 2}
          height={R * 2}
          preserveAspectRatio="xMidYMid meet"
        />,
      );
    }
    if (n > 5) {
      const cy = top ? FRAME + R + 4 + 4 * STACK_STEP : H - FRAME - R - 4 - 4 * STACK_STEP;
      counts.push(
        <SvgText key={`n${p}`} x={cx} y={cy + 14} fontSize={40} fontWeight="700" fill={mine ? C.countMe : C.countOpp} textAnchor="middle">
          {n}
        </SvgText>,
      );
    }
  }

  // Bar checkers.
  const barCx = barLeft + BAR_W / 2;
  const barGap = R + 16;
  const myBar = pts[BAR];
  const oppBar = -pts[0];
  const barNodes: ReactNode[] = [];
  for (let i = 0; i < Math.min(myBar, 4); i++)
    barNodes.push(<SvgImage key={`mb${i}`} href={CHECKER_LIGHT} x={barCx - R} y={H / 2 + barGap + i * STACK_STEP - R} width={R * 2} height={R * 2} />);
  for (let i = 0; i < Math.min(oppBar, 4); i++)
    barNodes.push(<SvgImage key={`ob${i}`} href={CHECKER_DARK} x={barCx - R} y={H / 2 - barGap - i * STACK_STEP - R} width={R * 2} height={R * 2} />);
  // Stacks past four show their count, like the points (same as the web board).
  if (myBar > 4)
    counts.push(
      <SvgText key="nmb" x={barCx} y={H / 2 + barGap + 14} fontSize={40} fontWeight="700" fill={C.countMe} textAnchor="middle">
        {myBar}
      </SvgText>,
    );
  if (oppBar > 4)
    counts.push(
      <SvgText key="nob" x={barCx} y={H / 2 - barGap + 14} fontSize={40} fontWeight="700" fill={C.countOpp} textAnchor="middle">
        {oppBar}
      </SvgText>,
    );

  // Bear-off pockets (edge-on capsules).
  const CAP_W = TRAY_W - 22;
  const CAP_H = wide ? 22 : 20;
  const OFF_STEP = Math.min(CAP_H + 2, (H / 2 - FRAME - 14 - CAP_H) / 14);
  const trayCX = trayLeft + TRAY_W / 2;
  const pockets: ReactNode[] = [];
  for (let i = 0; i < Math.min(board.oppOff, 15); i++)
    pockets.push(<Rect key={`po${i}`} x={trayCX - CAP_W / 2} y={FRAME + 14 + i * OFF_STEP} width={CAP_W} height={CAP_H} rx={CAP_H / 2} fill="#20242b" stroke="rgba(0,0,0,0.5)" strokeWidth={1} />);
  for (let i = 0; i < Math.min(board.myOff, 15); i++)
    pockets.push(<Rect key={`pm${i}`} x={trayCX - CAP_W / 2} y={H - FRAME - 14 - CAP_H - i * OFF_STEP} width={CAP_W} height={CAP_H} rx={CAP_H / 2} fill="#efe6d0" stroke="rgba(96,84,50,0.6)" strokeWidth={1} />);

  // Dice on the mover's half.
  const showDice = board.dice[0] !== 0;
  const mover = board.turn === 1;
  const diceCx = mover ? (barRight + trayLeft) / 2 : (boardLeft + barLeft) / 2;
  const usage = mover ? dieUsage(board.dice, pendingHops) : [0, 0];
  const dead = mover ? deadDice(board.points, board.dice) : [false, false];
  const isDouble = board.dice[0] === board.dice[1];
  const diceInteractive = mover && !!onDieClick && !isDouble;
  // The leading die sits in the left slot, so tapping to reorder visibly swaps
  // the dice (same as the web board).
  const diceOrder = mover && activeDie === 1 ? [1, 0] : [0, 1];

  // The cube lives on the bar but must never overlap checkers there (ported
  // from the web board). Find the clear space above the opponent's bar stack
  // and below mine, and place the cube in the zone that suits its owner (me =
  // bottom, gnubg = top), falling back to the roomier zone. A centered cube
  // rests in the middle only when the bar is empty.
  const CUBE = 64;
  const cubeVal = board.cubeValue === 1 ? 64 : board.cubeValue;
  const showCube = !board.crawford;
  const oppStackTop = oppBar > 0 ? H / 2 - barGap - (Math.min(oppBar, 4) - 1) * STACK_STEP - R : H / 2;
  const myStackBottom = myBar > 0 ? H / 2 + barGap + (Math.min(myBar, 4) - 1) * STACK_STEP + R : H / 2;
  const topSpace = oppStackTop - FRAME;
  const bottomSpace = H - FRAME - myStackBottom;
  const topCenter = FRAME + topSpace / 2;
  const bottomCenter = H - FRAME - bottomSpace / 2;
  const fits = (space: number) => space >= CUBE + 8;
  let cubeCy: number;
  if (board.iMayDouble && board.oppMayDouble) {
    cubeCy = myBar === 0 && oppBar === 0 ? H / 2 : topSpace >= bottomSpace ? topCenter : bottomCenter;
  } else if (board.iMayDouble) {
    cubeCy = fits(bottomSpace) ? bottomCenter : topCenter;
  } else {
    cubeCy = fits(topSpace) ? topCenter : bottomCenter;
  }
  cubeCy = Math.max(FRAME + CUBE / 2, Math.min(H - FRAME - CUBE / 2, cubeCy));

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
      {/* wood frame base */}
      <SvgImage href={WOOD} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />
      {/* felt halves */}
      <SvgImage href={FELT} x={boardLeft} y={FRAME} width={barLeft - boardLeft} height={H - FRAME * 2} preserveAspectRatio="xMidYMid slice" />
      <SvgImage href={FELT} x={barRight} y={FRAME} width={trayLeft - barRight} height={H - FRAME * 2} preserveAspectRatio="xMidYMid slice" />

      {/* points */}
      {Array.from({ length: 24 }, (_, i) => {
        const p = i + 1;
        const x = pointX(g, p);
        const top = isTop(p);
        const baseY = top ? FRAME : H - FRAME;
        const tipY = top ? FRAME + POINT_H : H - FRAME - POINT_H;
        return (
          <G key={`pt${p}`}>
            <Polygon points={`${x + 2},${baseY} ${x + COL_W - 2},${baseY} ${x + COL_W / 2},${tipY}`} fill={p % 2 === 0 ? C.ptA : C.ptB} opacity={0.95} />
            <SvgText x={x + COL_W / 2} y={top ? FRAME - 6 : H - FRAME + 18} fontSize={19} fill={C.label} textAnchor="middle">
              {p}
            </SvgText>
          </G>
        );
      })}

      {/* bar (wood) */}
      <SvgImage href={WOOD} x={barLeft} y={FRAME} width={BAR_W} height={H - FRAME * 2} preserveAspectRatio="xMidYMid slice" />
      {/* tray + sunken well */}
      <SvgImage href={WOOD} x={trayLeft} y={FRAME} width={TRAY_W} height={H - FRAME * 2} preserveAspectRatio="xMidYMid slice" />
      <Rect x={trayLeft + 6} y={FRAME + 6} width={TRAY_W - 12} height={H - FRAME * 2 - 12} rx={12} fill={C.wellBot} stroke="rgba(0,0,0,0.45)" strokeWidth={1.5} />

      {pockets}
      {checkers}
      {barNodes}
      {counts}

      {showCube && (
        <G x={barCx - CUBE / 2} y={cubeCy - CUBE / 2}>
          <Rect width={CUBE} height={CUBE} rx={10} fill={C.cube} stroke={C.cubeStroke} strokeWidth={2} />
          <SvgText x={CUBE / 2} y={CUBE / 2 + 12} fontSize={34} fontWeight="700" fill={C.cubeText} textAnchor="middle">
            {cubeVal}
          </SvgText>
        </G>
      )}

      {/* gold rings on tappable source points/bar */}
      {sources.map((p) => {
        if (p === BAR) return <Circle key={`hl${p}`} cx={barCx} cy={H / 2 + barGap} r={R + 5} fill="none" stroke="#d9b24a" strokeWidth={4} opacity={0.9} />;
        const top = isTop(p);
        const cx = pointX(g, p) + COL_W / 2;
        const topIdx = Math.max(Math.min(Math.abs(pts[p] || 0), 5) - 1, 0);
        const cy = top ? FRAME + R + 4 + topIdx * STACK_STEP : H - FRAME - R - 4 - topIdx * STACK_STEP;
        return <Circle key={`hl${p}`} cx={cx} cy={cy} r={R + 5} fill="none" stroke="#d9b24a" strokeWidth={4} opacity={0.9} />;
      })}

      {/* transparent tap zones on top (points 1-24 + bar) */}
      {onPointClick &&
        Array.from({ length: 24 }, (_, i) => {
          const p = i + 1;
          const x = pointX(g, p);
          const top = isTop(p);
          return (
            <Rect key={`hz${p}`} x={x} y={top ? FRAME : H / 2} width={COL_W} height={H / 2 - FRAME} fill="#000000" fillOpacity={0.001} onPress={() => onPointClick(p)} />
          );
        })}
      {onPointClick && (
        <Rect x={barLeft} y={FRAME} width={BAR_W} height={H - FRAME * 2} fill="#000000" fillOpacity={0.001} onPress={() => onPointClick(BAR)} />
      )}

      {/* dice last so taps on them win over the point tap zones */}
      {showDice && (
        <G>
          {diceOrder.map((di, slot) => (
            <Die
              key={di}
              x={diceCx - 70 + slot * 80}
              y={H / 2 - 30}
              value={board.dice[di]}
              mine={mover}
              used={dead[di] ? 1 : isDouble ? usage[di] / 2 : usage[di]}
              onPress={diceInteractive && !dead[di] ? () => onDieClick!(di) : undefined}
            />
          ))}
        </G>
      )}
    </Svg>
  );
}
