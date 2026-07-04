import { Hono } from 'hono';
import { createAuth } from './auth';
import type { Env } from './env';

const MAX_BODY_BYTES = 900 * 1024;

interface MatchRow {
  id: string;
  user_id: string;
  started_at: number | null;
  finished_at: number | null;
  match_length: number | null;
  my_score: number | null;
  opp_score: number | null;
  winner: string | null;
  decision_count: number | null;
  updated_at: number;
  data: string;
}

const app = new Hono<{ Bindings: Env }>();

app.all('/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

async function getSessionUser(c: { env: Env; req: { raw: Request } }) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

app.get('/api/me', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ user: { id: user.id, email: user.email } });
});

app.get('/api/matches', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT id, started_at, finished_at, match_length, my_score, opp_score, winner, updated_at, decision_count
     FROM matches WHERE user_id = ?1 ORDER BY started_at DESC`,
  )
    .bind(user.id)
    .all<Omit<MatchRow, 'user_id' | 'data'>>();
  return c.json({
    matches: results.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      matchLength: r.match_length,
      myScore: r.my_score,
      oppScore: r.opp_score,
      winner: r.winner,
      updatedAt: r.updated_at,
      decisionCount: r.decision_count,
    })),
  });
});

app.get('/api/matches/:id', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const row = await c.env.DB.prepare('SELECT user_id, data FROM matches WHERE id = ?1')
    .bind(c.req.param('id'))
    .first<Pick<MatchRow, 'user_id' | 'data'>>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ match: JSON.parse(row.data) });
});

app.put('/api/matches/:id', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return c.json({ error: 'Match record too large' }, 413);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Body must be a MatchRecord object' }, 400);
  }
  if (body.id !== id) {
    return c.json({ error: 'Body id must match URL id' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT user_id FROM matches WHERE id = ?1')
    .bind(id)
    .first<Pick<MatchRow, 'user_id'>>();
  if (existing && existing.user_id !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const updatedAt = Date.now();
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const decisions = body.decisions;
  await c.env.DB.prepare(
    `INSERT INTO matches (id, user_id, started_at, finished_at, match_length, my_score, opp_score, winner, decision_count, updated_at, data)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(id) DO UPDATE SET
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       match_length = excluded.match_length,
       my_score = excluded.my_score,
       opp_score = excluded.opp_score,
       winner = excluded.winner,
       decision_count = excluded.decision_count,
       updated_at = excluded.updated_at,
       data = excluded.data`,
  )
    .bind(
      id,
      user.id,
      num(body.startedAt),
      num(body.finishedAt),
      num(body.matchLength),
      num(body.myScore),
      num(body.oppScore),
      typeof body.winner === 'string' ? body.winner : null,
      Array.isArray(decisions) ? decisions.length : 0,
      updatedAt,
      raw,
    )
    .run();
  return c.json({ ok: true, updatedAt });
});

app.delete('/api/matches/:id', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT user_id FROM matches WHERE id = ?1')
    .bind(id)
    .first<Pick<MatchRow, 'user_id'>>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403);
  await c.env.DB.prepare('DELETE FROM matches WHERE id = ?1').bind(id).run();
  return c.json({ ok: true });
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Anything else that reaches the worker falls through to static assets.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
