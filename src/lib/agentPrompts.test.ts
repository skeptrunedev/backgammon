import { describe, expect, it } from 'vitest';
import { agentPrompt, promptForPath, type PromptPage } from './agentPrompts';
import worker from '../../worker/index.ts?raw';

const PAGES: PromptPage[] = ['home', 'play', 'match', 'trends', 'training', 'pip', 'privacy'];

// "METHOD /api/..." routes the Worker serves, e.g. "GET /api/matches/:id".
const served = [...worker.matchAll(/app\.(get|put|post|delete)\('(\/api\/[^']+)'/g)].map(
  ([, method, path]) => ({ method: method.toUpperCase(), re: new RegExp('^' + path.replace(/:[a-z]+/gi, '[^/]+') + '$') }),
);

describe('agent prompts', () => {
  it('found the Worker routes', () => expect(served.length).toBeGreaterThan(10));

  it('every app page has a prompt', () => {
    for (const path of ['/', '/play/abc', '/match/abc', '/trends', '/training', '/pip', '/privacy']) {
      expect(promptForPath(path), path).toBeTruthy();
    }
    expect(promptForPath('/nope')).toBeNull();
  });

  it('carries the match id from the URL', () => {
    expect(promptForPath('/play/m42')).toContain('/api/matches/m42');
    expect(promptForPath('/match/m42')).toContain('/api/matches/m42');
  });

  it('only calls API routes the Worker serves', () => {
    for (const page of PAGES) {
      const calls = [...agentPrompt(page, { matchId: 'm1' }).matchAll(/\b(GET|PUT|POST|DELETE) https:\/\/bg\.skeptrune\.com(\/api\/[^\s,.;)"]+)/g)];
      expect(calls.length, page).toBeGreaterThan(0);
      for (const [, method, path] of calls) {
        const clean = path.replace(/<[^>]+>/g, 'x');
        const ok = clean.startsWith('/api/auth/') || served.some((r) => r.method === method && r.re.test(clean));
        expect(ok, `${page}: ${method} ${path}`).toBe(true);
      }
    }
  });
});
