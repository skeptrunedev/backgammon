import type { MemgPoint } from '../game/trends';

// Fixed SVG coordinate space; the element scales responsively via viewBox +
// width:100%. Chosen for a comfortable phone aspect ratio.
const VW = 320;
const VH = 180;
const PAD = { top: 14, right: 12, bottom: 22, left: 34 };
const PLOT_W = VW - PAD.left - PAD.right;
const PLOT_H = VH - PAD.top - PAD.bottom;

interface Line {
  slope: number;
  intercept: number;
}

// Ordinary least-squares fit over x = index (0..n-1), y = mEMG.
function leastSquares(ys: number[]): Line {
  const n = ys.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += ys[i];
    sxx += i * i;
    sxy += i * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export default function MemgChart({ points }: { points: MemgPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No analyzed matches yet.
      </p>
    );
  }

  if (points.length === 1) {
    return (
      <div className="flex flex-col items-center gap-1 py-6">
        <span className="text-3xl font-semibold tabular-nums text-foreground">
          {points[0].mEMG}
        </span>
        <span className="text-xs text-muted-foreground">mEMG this match — lower is better</span>
        <span className="mt-1 text-xs text-muted-foreground">
          Play more games to see a trend.
        </span>
      </div>
    );
  }

  const ys = points.map((p) => p.mEMG);
  const n = ys.length;

  // y range with a little headroom; keep 0 as the floor since mEMG >= 0.
  const rawMax = Math.max(...ys);
  const yMax = rawMax <= 0 ? 1 : rawMax * 1.15;
  const yMin = 0;

  const x = (i: number) => PAD.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) =>
    PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.mEMG).toFixed(2)}`)
    .join(' ');

  const fit = leastSquares(ys);
  const trendStartY = fit.intercept;
  const trendEndY = fit.slope * (n - 1) + fit.intercept;

  // Lower mEMG is better, so a negative slope means improving.
  const improving = fit.slope < -0.05;
  const worsening = fit.slope > 0.05;
  const trendClass = improving
    ? 'text-emerald-500'
    : worsening
      ? 'text-amber-500'
      : 'text-muted-foreground';

  const first = round1(ys[0]);
  const latest = round1(ys[n - 1]);
  const caption = improving
    ? "Trending down — you're improving"
    : worsening
      ? 'Trending up — more errors lately'
      : 'Roughly flat';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={`text-sm font-medium ${trendClass}`}>{caption}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {first} → {latest} mEMG
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Error rate per match over time. ${caption}. First ${first} mEMG, latest ${latest} mEMG.`}
      >
        {/* baseline (y = 0) */}
        <line
          x1={PAD.left}
          y1={y(yMin)}
          x2={VW - PAD.right}
          y2={y(yMin)}
          className="stroke-border"
          strokeWidth={1}
        />
        {/* y-axis labels: max and 0 */}
        <text
          x={PAD.left - 5}
          y={y(yMax) + 3}
          textAnchor="end"
          className="fill-muted-foreground text-[8px] tabular-nums"
        >
          {round1(yMax)}
        </text>
        <text
          x={PAD.left - 5}
          y={y(yMin) + 3}
          textAnchor="end"
          className="fill-muted-foreground text-[8px] tabular-nums"
        >
          0
        </text>

        {/* least-squares trend line */}
        <line
          x1={x(0)}
          y1={y(trendStartY)}
          x2={x(n - 1)}
          y2={y(trendEndY)}
          className={trendClass}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          strokeLinecap="round"
        />

        {/* mEMG series line */}
        <path
          d={linePath}
          fill="none"
          className="text-primary"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.mEMG)}
            r={2.25}
            className="fill-primary"
          />
        ))}

        {/* x-axis labels: oldest / newest */}
        <text
          x={PAD.left}
          y={VH - 6}
          textAnchor="start"
          className="fill-muted-foreground text-[8px]"
        >
          oldest
        </text>
        <text
          x={VW - PAD.right}
          y={VH - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[8px]"
        >
          newest
        </text>
      </svg>

      <p className="text-xs text-muted-foreground">
        Each point is one match's mEMG (equity lost per decision). Lower is better.
      </p>
    </div>
  );
}
