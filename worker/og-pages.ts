/**
 * Social preview metadata for every page. Shared by the Worker (which writes
 * the tags into each page's HTML, since link unfurlers never run the SPA) and
 * by scripts/og-cards.ts (which renders each page's 1200x630 card at build).
 * Plain TypeScript with no imports so Node can run it directly.
 */

export const SITE = 'https://bg.skeptrune.com';
export const SITE_NAME = 'Backgammon';

export interface OgPage {
  /** Card file under /og/, e.g. "home" for /og/home.png. */
  slug: string;
  /** Page title; the site name is appended except on the home page. */
  title: string;
  /** Sentence shown under the link in Slack, Discord, X, Signal, iMessage. */
  description: string;
  /** Big text on the card. */
  cardTitle: string;
  /** Smaller line under the card title. */
  cardSubtitle: string;
}

export const HOME: OgPage = {
  slug: 'home',
  title: 'Backgammon vs GNU Backgammon',
  description:
    'Play backgammon matches against GNU Backgammon, the neural-network engine serious players study with, then review every decision you made.',
  cardTitle: 'Play backgammon against GNU Backgammon',
  cardSubtitle: 'Matches up to 11 points, then a review of every decision you made',
};

export const PAGES: OgPage[] = [
  HOME,
  {
    slug: 'play',
    title: 'Play a match',
    description:
      'A backgammon match against GNU Backgammon, with the doubling cube, Crawford rule, gammons and backgammons.',
    cardTitle: 'Play a match',
    cardSubtitle: 'Against GNU Backgammon, with the doubling cube and Crawford rule',
  },
  {
    slug: 'match',
    title: 'Match analysis',
    description:
      'A move-by-move review of a backgammon match against GNU Backgammon: every checker play and cube decision, with the equity each one cost.',
    cardTitle: 'Match analysis',
    cardSubtitle: 'Every checker play and cube decision, with the equity each one cost',
  },
  {
    slug: 'trends',
    title: 'Trends',
    description:
      'Your backgammon skill estimate from the equity lost per decision, your progress over time, and your most common mistakes.',
    cardTitle: 'Track your backgammon skill',
    cardSubtitle: 'Equity lost per decision, progress over time, and your most common mistakes',
  },
  {
    slug: 'training',
    title: 'Training',
    description:
      'Replay decisions from your own backgammon matches and choose your move before seeing the answer.',
    cardTitle: 'Train on your own mistakes',
    cardSubtitle: 'Replay decisions from your matches before seeing the answer',
  },
  {
    slug: 'pip',
    title: 'Pip count training',
    description:
      'Learn a colorless pip-counting method, then build speed on positions from your own backgammon matches.',
    cardTitle: 'Pip count training',
    cardSubtitle: 'Learn a colorless counting method, then build speed on your own positions',
  },
  {
    slug: 'privacy',
    title: 'Privacy policy',
    description: 'What the Backgammon web and Android apps collect, and how that data is used.',
    cardTitle: 'Privacy policy',
    cardSubtitle: 'What the web and Android apps collect, and how that data is used',
  },
];

const bySlug = (slug: string) => PAGES.find((p) => p.slug === slug) ?? HOME;

/** The preview for a request path; unknown paths get the home page's. */
export function pageForPath(path: string): OgPage {
  if (path.startsWith('/play/')) return bySlug('play');
  if (path.startsWith('/match/')) return bySlug('match');
  const slug = path.replace(/^\/+|\/+$/g, '');
  return PAGES.find((p) => p.slug === slug && p !== HOME) ?? HOME;
}

export function fullTitle(page: OgPage): string {
  return page === HOME ? page.title : `${page.title} · ${SITE_NAME}`;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The <head> tags for one page. Open Graph covers Slack, Discord, Signal,
 * iMessage, Facebook and LinkedIn; the twitter: tags cover X. Image URLs are
 * absolute HTTPS PNGs with explicit dimensions, which every unfurler accepts.
 */
export function headTags(page: OgPage, path: string): string {
  const title = esc(fullTitle(page));
  const description = esc(page.description);
  const url = esc(SITE + path);
  const image = `${SITE}/og/${page.slug}.png`;
  const alt = esc(`${page.cardTitle}: ${page.cardSubtitle}`);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${alt}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="@skeptrune" />`,
    `<meta name="twitter:creator" content="@skeptrune" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${alt}" />`,
  ].join('\n    ');
}
