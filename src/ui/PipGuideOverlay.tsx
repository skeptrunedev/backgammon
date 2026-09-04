import { useId } from 'react';
import type { PipMethod } from '../game/pipTraining';

const bands = [
  [932, 480], [657, 480], [299, 480], [24, 480],
  [24, 24], [299, 24], [657, 24], [932, 24],
] as const;

export default function PipGuideOverlay({ method, step }: { method: PipMethod; step: number }) {
  const marker = `pip-arrow-${useId().replace(/:/g, '')}`;
  const unitArrows = bands.map(([x, y], i) => <path key={i} d={`M${x + 65} ${y + 228}h135`} />);
  let shapes;

  if (method === 'urquhart') {
    shapes = step === 0
      ? <><path d="M1180 720H760M140 720h420M140 240h420M1180 240H760" /><path d="M1080 600H840M240 600h240M240 360h240M1080 360H840" /></>
      : step === 1
        ? bands.filter((_, i) => [0, 2, 4, 6].includes(i)).map(([x, y], i) => <rect key={i} x={x} y={y} width="274" height="456" />)
        : unitArrows;
  } else if (method === '321') {
    shapes = step === 0
      ? <><rect x="657" y="480" width="549" height="456" opacity=".2" /><rect x="24" y="480" width="549" height="456" opacity=".14" /><rect x="24" y="24" width="549" height="456" opacity=".08" /><g fill="oklch(0.88 0.17 82)" stroke="none"><circle cx="932" cy="690" r="18"/><circle cx="882" cy="690" r="18"/><circle cx="982" cy="690" r="18"/><circle cx="249" cy="690" r="18"/><circle cx="349" cy="690" r="18"/><circle cx="299" cy="270" r="18"/></g></>
      : step === 1
        ? <path d="M1170 720H910V240H560V720H110V240H360" />
        : step === 3 ? unitArrows : <rect x="87" y="24" width="1143" height="912" opacity=".1" />;
  } else {
    shapes = step === 0
      ? <><path d="M1160 750L930 210M930 750l230-540M520 750L290 210M290 750l230-540" />{bands.filter((_, i) => [0, 2, 5, 7].includes(i)).map(([x, y], i) => <rect key={i} x={x} y={y} width="274" height="456" />)}</>
      : step === 1
        ? <><rect x="87" y="24" width="237" height="912" /><rect x="993" y="24" width="237" height="912" /><path d="M300 480H1020" /></>
        : step === 2
          ? <><path d="M1120 720L180 240M180 720l940-480" /><circle cx="655" cy="480" r="105" /></>
          : step === 4 ? unitArrows : <rect x="87" y="24" width="1143" height="912" opacity=".1" />;
  }

  return <g className="pip-guide" pointerEvents="none">
    <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0l10 5-10 5z" /></marker></defs>
    <g fill="oklch(0.82 0.17 82 / 18%)" stroke="oklch(0.88 0.17 82)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#${marker})`}>{shapes}</g>
  </g>;
}
