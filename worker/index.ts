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

interface SettingsRow {
  model: string | null;
  key_ciphertext: string | null;
  key_iv: string | null;
}

// ---- AES-256-GCM encryption of users' Anthropic keys, at rest in D1 ----
function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function settingsCryptoKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64decode(env.SETTINGS_KEY), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}
async function encryptSecret(env: Env, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await settingsCryptoKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { ciphertext: b64encode(new Uint8Array(buf)), iv: b64encode(iv) };
}
async function decryptSecret(env: Env, ciphertext: string, iv: string): Promise<string> {
  const key = await settingsCryptoKey(env);
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(iv) }, key, b64decode(ciphertext));
  return new TextDecoder().decode(buf);
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

// ---- Per-user AI settings (Anthropic key, encrypted at rest) ----
app.get('/api/settings', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    'SELECT model, key_ciphertext FROM user_settings WHERE user_id = ?1',
  )
    .bind(user.id)
    .first<Pick<SettingsRow, 'model' | 'key_ciphertext'>>();
  return c.json({ hasKey: !!row?.key_ciphertext, model: row?.model ?? 'claude-opus-4-8' });
});

app.put('/api/settings', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  let body: { apiKey?: unknown; model?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const model =
    typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'claude-opus-4-8';

  const existing = await c.env.DB.prepare(
    'SELECT key_ciphertext, key_iv FROM user_settings WHERE user_id = ?1',
  )
    .bind(user.id)
    .first<Pick<SettingsRow, 'key_ciphertext' | 'key_iv'>>();
  let ciphertext = existing?.key_ciphertext ?? null;
  let iv = existing?.key_iv ?? null;

  // apiKey omitted → keep existing key (model-only update).
  // apiKey === '' → explicit clear. apiKey non-empty → encrypt & replace.
  if (typeof body.apiKey === 'string') {
    const trimmed = body.apiKey.trim();
    if (trimmed === '') {
      ciphertext = null;
      iv = null;
    } else {
      const enc = await encryptSecret(c.env, trimmed);
      ciphertext = enc.ciphertext;
      iv = enc.iv;
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO user_settings (user_id, model, key_ciphertext, key_iv, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET
       model = excluded.model,
       key_ciphertext = excluded.key_ciphertext,
       key_iv = excluded.key_iv,
       updated_at = excluded.updated_at`,
  )
    .bind(user.id, model, ciphertext, iv, Date.now())
    .run();
  return c.json({ ok: true, hasKey: !!ciphertext, model });
});

// Proxy an Anthropic explanation using the caller's stored key. The key is
// decrypted only here, in-memory, and never returned to the client.
app.post('/api/explain', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return c.json({ error: 'Prompt too large' }, 413);
  }
  let body: { prompt?: unknown; model?: unknown; maxTokens?: unknown; system?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) return c.json({ error: 'Missing prompt' }, 400);

  const maxTokens = Math.min(Math.max(Math.round(Number(body.maxTokens)) || 300, 1), 2000);
  const defaultSystem =
    'You are a world-class backgammon coach explaining engine evaluations to an improving player. Be brief and direct: 2-3 sentences, under ~60 words, no preamble or filler. Lead with the single most important reason.';
  const system =
    typeof body.system === 'string' && body.system.trim() ? body.system : defaultSystem;

  const row = await c.env.DB.prepare(
    'SELECT model, key_ciphertext, key_iv FROM user_settings WHERE user_id = ?1',
  )
    .bind(user.id)
    .first<SettingsRow>();
  if (!row?.key_ciphertext || !row.key_iv) {
    return c.json({ error: 'No Anthropic API key set. Add one in Settings.' }, 400);
  }
  const apiKey = await decryptSecret(c.env, row.key_ciphertext, row.key_iv);
  const model =
    (typeof body.model === 'string' && body.model.trim()) || row.model || 'claude-opus-4-8';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    return c.json({ error: `Anthropic API error ${res.status}: ${errBody.slice(0, 300)}` }, 502);
  }
  const data = await res.json<{ content?: { type: string; text?: string }[] }>();
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
  return c.json({ text: text || 'No explanation returned.' });
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Anything else that reaches the worker falls through to static assets.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
