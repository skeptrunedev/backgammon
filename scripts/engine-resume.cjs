#!/usr/bin/env node
/*
 * Verifies gnubg WASM native save/reload of a match:
 *   play some moves in a 3-pt match -> `save match "/r.sgf"` -> read SGF
 *   -> `new match 1` (wipe) -> writeFile SGF back + `load match "/r.sgf"`
 *   -> assert restored board == saved board (checker layout, score, length).
 * Run: npm run resume [-- --verbose]
 */
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', e instanceof Error ? e.message : e);
  console.error(e instanceof Error ? (e.stack || '').split('\n').slice(1, 4).join('\n') : '');
  process.exit(1);
});

const ENGINE_DIR = path.join(__dirname, '..', 'public', 'engine');
const VERBOSE = process.argv.includes('--verbose');

let out = [];
let lastBoard = null;
let resignOffered = false;

function onLine(s) {
  out.push(s);
  if (VERBOSE) console.log('|', s);
  if (s.startsWith('board:')) lastBoard = s;
  if (s.includes('offers to resign')) resignOffered = true;
}

global.Module = {
  print: onLine,
  printErr: onLine,
  locateFile: (p) => path.join(ENGINE_DIR, p),
  preRun: [
    function () {
      /* eslint-disable no-undef */
      FS.init(() => null, null, null);
    },
  ],
  onRuntimeInitialized: () => setTimeout(main, 0),
};

let cmdBuf = 0;
function cmd(text) {
  out = [];
  if (!cmdBuf) cmdBuf = Module._malloc(4096);
  const n = Math.min(text.length, 4095);
  for (let i = 0; i < n; i++) Module.setValue(cmdBuf + i, text.charCodeAt(i) & 0x7f, 'i8');
  Module.setValue(cmdBuf + n, 0, 'i8');
  Module._run_command(cmdBuf);
  return out.slice();
}

function nextTurn() {
  out = [];
  Module._doNextTurn();
  return out.slice();
}

// Board fields relevant to position identity.
function parseBoard(line) {
  const f = line.split(':');
  const num = (i) => parseInt(f[i], 10);
  return {
    matchLength: num(3),
    myScore: num(4),
    oppScore: num(5),
    // The 26-entry point layout f[6]..f[31] is the checker positions.
    points: f.slice(6, 32).join(','),
    turn: num(32),
    cube: num(37),
  };
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function main() {
  Module._start();
  const setup = [
    'set confirm new off',
    'set confirm save off',
    'set output mwc off',
    'set automatic game on',
    'set player 1 chequerplay evaluation plies 0',
    'set player 1 chequerplay evaluation prune on',
    'set player 1 cubedecision evaluation plies 0',
    'set evaluation chequerplay evaluation plies 0',
    'set evaluation cubedecision evaluation plies 0',
  ];
  for (const c of setup) cmd(c);

  console.log('=== play a few moves in a 3-point match ===');
  const act = (c) => { lastBoard = null; return cmd(c); };
  act('new match 3');
  cmd('set player 1 name You');

  let moves = 0;
  let quiet = 0;
  const MAX_MOVES = 6; // just play a handful, we want a mid-match position
  for (let i = 0; i < 3000 && moves < MAX_MOVES; i++) {
    const b = lastBoard ? parseBoard(lastBoard) : null;
    if (resignOffered) { resignOffered = false; act('accept'); continue; }
    if (!b) {
      const produced = nextTurn();
      if (produced.length === 0) {
        quiet++;
        if (quiet % 4 === 3) cmd('show board');
        if (quiet > 40) fail('engine went quiet with no board');
      } else quiet = 0;
      continue;
    }
    quiet = 0;
    // wasDoubled at field 40
    const wasDoubled = parseInt(lastBoard.split(':')[40], 10) !== 0;
    if (wasDoubled) { act('take'); continue; }
    const dice = lastBoard.split(':');
    const d33 = parseInt(dice[33], 10);
    if (b.turn === 1 && d33 > 0) {
      const hintOut = cmd('hint 5');
      const joined = hintOut.join('\n');
      const m = /^\s*1\.\s+(?:Cubeful|Cubeless)\s+\S+\s+(.+?)\s+(?:Eq\.|MWC):/m.exec(joined);
      if (m) {
        const r = act('move ' + m[1].trim());
        if (r.some((l) => /illegal|invalid/i.test(l))) fail(`move rejected: ${m[1]}`);
        moves++;
      } else act('move');
      continue;
    }
    if (b.turn === 1 && d33 === 0) { act('roll'); continue; }
    nextTurn();
  }
  console.log('human moves played:', moves);

  // Capture the live board BEFORE saving.
  cmd('show board');
  const savedBoardLine = lastBoard;
  const saved = parseBoard(savedBoardLine);
  console.log('saved position:', JSON.stringify(saved));

  console.log('=== save match ===');
  const saveOut = cmd('save match "/r.sgf"');
  if (VERBOSE) for (const l of saveOut) console.log('  ', l);
  /* eslint-disable no-undef */
  const sgf = FS.readFile('/r.sgf', { encoding: 'utf8' });
  console.log('SGF bytes:', Buffer.byteLength(sgf, 'utf8'));
  if (Buffer.byteLength(sgf, 'utf8') === 0) fail('SGF is empty');
  if (Buffer.byteLength(sgf, 'utf8') > 900 * 1024) fail('SGF exceeds 900KB PUT limit');

  console.log('=== wipe with `new match 1` ===');
  act('new match 1');
  cmd('show board');
  const wipedLine = lastBoard;
  const wiped = parseBoard(wipedLine);
  console.log('wiped position:', JSON.stringify(wiped));

  console.log('=== writeFile SGF back + load match ===');
  FS.writeFile('/r.sgf', sgf);
  lastBoard = null;
  const loadOut = cmd('load match "/r.sgf"');
  if (VERBOSE) for (const l of loadOut) console.log('  ', l);
  // load match emits a fresh board line
  if (!lastBoard) cmd('show board');
  const restored = parseBoard(lastBoard);
  console.log('restored position:', JSON.stringify(restored));

  // Assertions
  let ok = true;
  const check = (name, a, b) => {
    const pass = a === b;
    if (!pass) ok = false;
    console.log(`  ${pass ? 'ok ' : 'XX '} ${name}: saved=${a} restored=${b}`);
  };
  check('matchLength', saved.matchLength, restored.matchLength);
  check('myScore', saved.myScore, restored.myScore);
  check('oppScore', saved.oppScore, restored.oppScore);
  check('cube', saved.cube, restored.cube);
  check('points', saved.points, restored.points);
  check('turn', saved.turn, restored.turn);

  // Sanity: wiped state must differ from saved (proves we really reloaded).
  if (wiped.matchLength === saved.matchLength && wiped.points === saved.points) {
    console.log('  WARN: wiped state matched saved — wipe may not have reset');
  }

  if (!ok) fail('restored position does not match saved position');
  console.log('\nRESUME PASS');
  process.exit(0);
}

const realFetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/') && fs.existsSync(url)) {
    const buf = fs.readFileSync(url);
    return Promise.resolve(new Response(buf, { headers: { 'Content-Type': 'application/wasm' } }));
  }
  return realFetch(url, opts);
};

global.__dirname = ENGINE_DIR;
global.__filename = path.join(ENGINE_DIR, 'gnubg.js');
global.require = require;
global.location = { pathname: '/engine/gnubg.js', href: '/engine/gnubg.js' };
global.XMLHttpRequest = class {
  open(_method, url) { this.url = url; }
  send() {
    try {
      const buf = fs.readFileSync(this.url);
      this.response = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      this.status = 200;
      if (this.onload) this.onload();
    } catch (e) {
      if (this.onerror) this.onerror(e);
    }
  }
};

const src = fs.readFileSync(path.join(ENGINE_DIR, 'gnubg.js'), 'utf8');
(0, eval)(src);
