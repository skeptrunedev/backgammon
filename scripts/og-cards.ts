/**
 * Renders the 1200x630 Open Graph card for every page in worker/og-pages.ts to
 * public/og/<slug>.png. Runs before `vite build`, so the cards ship as static
 * assets. Same approach as skillbay's cards (SVG template, DejaVu fonts,
 * resvg), rendered once at build because every card here is static.
 *
 * Usage: node scripts/og-cards.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PAGES, type OgPage } from '../worker/og-pages.ts';

const W = 1200;
const H = 630;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = [join(root, 'scripts/og-fonts/DejaVuSans-Bold.ttf'), join(root, 'scripts/og-fonts/DejaVuSans.ttf')];

// The app's palette (see src/ui/Board.tsx and index.html's theme-color).
const C = {
  bg: '#14110d',
  wood: '#3a2616',
  felt: '#1f3d2e',
  ptA: '#a98d5e',
  ptB: '#473829',
  light: '#efe6d0',
  dark: '#221b14',
  gold: '#c8a24a',
  title: '#efe6d0',
  sub: '#c8b993',
  dim: '#8a7f68',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Greedy word wrap by estimated glyph width (DejaVu Sans Bold is ~0.62em per char). */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length)
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…';
  return lines;
}

/** A corner of a backgammon board: six points each side, a few checkers, two dice. */
function boardArt(): string {
  const x0 = 790;
  const y0 = 60;
  const w = 350;
  const h = 510;
  const frame = 18;
  const col = (w - frame * 2) / 6;
  const pointH = 200;
  const r = col / 2 - 5;
  const parts: string[] = [
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="14" fill="${C.wood}"/>`,
    `<rect x="${x0 + frame}" y="${y0 + frame}" width="${w - frame * 2}" height="${h - frame * 2}" fill="${C.felt}"/>`,
  ];
  for (let i = 0; i < 6; i++) {
    const x = x0 + frame + i * col;
    const top = y0 + frame;
    const bot = y0 + h - frame;
    parts.push(`<polygon points="${x + 2},${top} ${x + col - 2},${top} ${x + col / 2},${top + pointH}" fill="${i % 2 ? C.ptB : C.ptA}"/>`);
    parts.push(`<polygon points="${x + 2},${bot} ${x + col - 2},${bot} ${x + col / 2},${bot - pointH}" fill="${i % 2 ? C.ptA : C.ptB}"/>`);
  }
  // Checker stacks: [column, count, top?, light?]
  const stacks: [number, number, boolean, boolean][] = [
    [0, 5, true, false],
    [4, 3, true, true],
    [1, 2, false, true],
    [5, 5, false, false],
    [3, 3, false, true],
  ];
  for (const [c, n, top, light] of stacks) {
    const cx = x0 + frame + c * col + col / 2;
    for (let k = 0; k < n; k++) {
      const cy = top ? y0 + frame + r + 2 + k * (r * 2 - 4) : y0 + h - frame - r - 2 - k * (r * 2 - 4);
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${light ? C.light : C.dark}" stroke="${light ? '#b9a67c' : '#5b4a38'}" stroke-width="2"/>`,
      );
    }
  }
  // Two dice resting mid-board.
  const dice = [
    [x0 + w / 2 - 70, y0 + h / 2 - 28, [[14, 14], [42, 42]]],
    [x0 + w / 2 + 14, y0 + h / 2 - 28, [[14, 14], [42, 14], [28, 28], [14, 42], [42, 42]]],
  ] as const;
  for (const [dx, dy, pips] of dice) {
    parts.push(`<rect x="${dx}" y="${dy}" width="56" height="56" rx="10" fill="${C.light}" stroke="#b9a67c" stroke-width="2"/>`);
    for (const [px, py] of pips) parts.push(`<circle cx="${dx + px}" cy="${dy + py}" r="5.5" fill="#3f3828"/>`);
  }
  return parts.join('\n  ');
}

function cardSvg(page: OgPage): string {
  // Text must stay left of the board art (x < 760): ~680px at ~0.62em per bold glyph.
  const titleSize = page.cardTitle.length > 24 ? 56 : 70;
  const titleLines = wrap(page.cardTitle, titleSize > 60 ? 15 : 19, 3);
  const subLines = wrap(page.cardSubtitle, 36, titleLines.length >= 3 ? 2 : 3);
  const lineH = titleSize * 1.14;
  const titleY = 250;
  const subY = titleY + (titleLines.length - 1) * lineH + 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <text x="72" y="118" font-family="DejaVu Sans" font-weight="bold" font-size="46" fill="${C.gold}">Backgammon</text>
  <text x="72" y="160" font-family="DejaVu Sans" font-size="26" fill="${C.dim}">vs GNU Backgammon</text>
  ${titleLines.map((l, i) => `<text x="72" y="${titleY + i * lineH}" font-family="DejaVu Sans" font-weight="bold" font-size="${titleSize}" fill="${C.title}">${esc(l)}</text>`).join('\n  ')}
  ${subLines.map((l, i) => `<text x="72" y="${subY + i * 42}" font-family="DejaVu Sans" font-size="31" fill="${C.sub}">${esc(l)}</text>`).join('\n  ')}
  <text x="72" y="${H - 58}" font-family="DejaVu Sans" font-size="28" fill="${C.dim}">bg.skeptrune.com</text>
  ${boardArt()}
</svg>`;
}

const out = join(root, 'public/og');
mkdirSync(out, { recursive: true });
for (const page of PAGES) {
  const png = new Resvg(cardSvg(page), {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: fonts, defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false },
  })
    .render()
    .asPng();
  writeFileSync(join(out, `${page.slug}.png`), png);
  console.log(`og: ${page.slug}.png (${png.byteLength} bytes)`);
}
