import type { ReactNode } from 'react';
import Svg, { Rect, Polygon, Circle, G, Image as SvgImage, Text as SvgText } from 'react-native-svg';
import type { BoardState, CheckerHop } from '../engine/types';
import { BAR } from '../engine/types';
import { applyHopsToPoints } from '../engine/parse';

// Sprites (same assets as the web app) so the board reads identically.
const WOOD = require('../../assets/sprites/wood-dark.jpg');
const FELT = require('../../assets/sprites/felt.jpg');
const CHECKER_LIGHT = require('../../assets/sprites/checker-light.png');
const CHECKER_DARK = require('../../assets/sprites/checker-dark.png');
const DIE_LIGHT = require('../../assets/sprites/die-light.png');
const DIE_DARK = require('../../assets/sprites/die-dark.png');

// Geometry ported from the web board (default, non-wide).
const W = 1320;
const H = 960;
const FRAME = 24;
const TRAY_W = 90;
const BAR_W = 84;
const COL_W = (W - FRAME * 2 - TRAY_W - BAR_W) / 12;
const R = Math.min(COL_W / 2 - 6, 40);
const POINT_H = 340;
const boardLeft = FRAME;
const barLeft = boardLeft + COL_W * 6;
const barRight = barLeft + BAR_W;
const trayLeft = W - FRAME - TRAY_W;
const STACK_STEP = Math.min(R * 2 - 2, (H / 2 - FRAME - 2 * R - 4) / 4);

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
};

function pointX(p: number): number {
  if (p >= 1 && p <= 6) return barRight + (6 - p) * COL_W;
  if (p >= 7 && p <= 12) return boardLeft + (12 - p) * COL_W;
  if (p >= 13 && p <= 18) return boardLeft + (p - 13) * COL_W;
  return barRight + (p - 19) * COL_W;
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

function Die({ x, y, value, mine }: { x: number; y: number; value: number; mine: boolean }) {
  return (
    <G x={x} y={y}>
      <SvgImage href={mine ? DIE_LIGHT : DIE_DARK} x={0} y={0} width={60} height={60} preserveAspectRatio="xMidYMid meet" />
      {(PIPS[value] ?? []).map(([px, py], i) => (
        <Circle key={i} cx={px} cy={py} r={5.5} fill={mine ? C.pipLight : C.pipDark} />
      ))}
    </G>
  );
}

export function Board({
  board,
  pendingHops = [],
  sources = [],
  onPointClick,
}: {
  board: BoardState;
  pendingHops?: CheckerHop[];
  sources?: number[];
  onPointClick?: (p: number) => void;
}) {
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
    const cx = pointX(p) + COL_W / 2;
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

  // Bear-off pockets (edge-on capsules).
  const CAP_W = TRAY_W - 22;
  const CAP_H = 20;
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

  // Cube at rest on the bar rail.
  const CUBE = 64;
  const cubeVal = board.cubeValue === 1 ? 64 : board.cubeValue;
  const showCube = !board.crawford;

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
        const x = pointX(p);
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

      {showDice && (
        <G>
          <Die x={diceCx - 66} y={H / 2 - 30} value={board.dice[0]} mine={mover} />
          <Die x={diceCx + 6} y={H / 2 - 30} value={board.dice[1]} mine={mover} />
        </G>
      )}

      {showCube && (
        <G x={barCx - CUBE / 2} y={H / 2 - CUBE / 2}>
          <Rect width={CUBE} height={CUBE} rx={10} fill={C.cube} stroke={C.cubeStroke} strokeWidth={2} />
          <SvgText x={CUBE / 2} y={CUBE / 2 + 12} fontSize={34} fontWeight="700" fill={C.cubeText} textAnchor="middle">
            {cubeVal}
          </SvgText>
        </G>
      )}

      {/* gold rings on tappable source points/bar */}
      {sources.map((p) => {
        if (p === BAR) return <Circle key={`hl${p}`} cx={barCx} cy={H / 2} r={R + 6} fill="none" stroke="#d9b24a" strokeWidth={4} opacity={0.9} />;
        const top = isTop(p);
        const cx = pointX(p) + COL_W / 2;
        const topIdx = Math.max(Math.min(Math.abs(pts[p] || 0), 5) - 1, 0);
        const cy = top ? FRAME + R + 4 + topIdx * STACK_STEP : H - FRAME - R - 4 - topIdx * STACK_STEP;
        return <Circle key={`hl${p}`} cx={cx} cy={cy} r={R + 5} fill="none" stroke="#d9b24a" strokeWidth={4} opacity={0.9} />;
      })}

      {/* transparent tap zones on top (points 1-24 + bar) */}
      {onPointClick &&
        Array.from({ length: 24 }, (_, i) => {
          const p = i + 1;
          const x = pointX(p);
          const top = isTop(p);
          return (
            <Rect key={`hz${p}`} x={x} y={top ? FRAME : H / 2} width={COL_W} height={H / 2 - FRAME} fill="#000000" fillOpacity={0.001} onPress={() => onPointClick(p)} />
          );
        })}
      {onPointClick && (
        <Rect x={barLeft} y={FRAME} width={BAR_W} height={H - FRAME * 2} fill="#000000" fillOpacity={0.001} onPress={() => onPointClick(BAR)} />
      )}
    </Svg>
  );
}
