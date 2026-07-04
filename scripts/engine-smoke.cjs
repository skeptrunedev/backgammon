#!/usr/bin/env node
/*
 * Loads the gnubg WASM build the same way src/engine/worker.ts does
 * (indirect eval in global scope) and auto-plays a 1-point match at
 * 0-ply to validate the command protocol, board output, hint format
 * and .mat export. Run: npm run smoke [-- --verbose]
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
const allLines = [];
let lastBoard = null;
let resignOffered = false;

function onLine(s) {
  out.push(s);
  allLines.push(s);
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

function parseBoard(line) {
  const f = line.split(':');
  const num = (i) => parseInt(f[i], 10);
  return {
    me: f[1],
    opp: f[2],
    matchLength: num(3),
    myScore: num(4),
    oppScore: num(5),
    turn: num(32),
    dice: num(33) > 0 ? [num(33), num(34)] : [num(35), num(36)],
    cube: num(37),
    iMayDouble: num(38) === 1,
    wasDoubled: num(40) !== 0,
  };
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

let dumpedMoveHint = false;
let dumpedCubeHint = false;

function main() {
  Module._start();
  section('version');
  console.log(cmd('show version').slice(0, 2).join('\n'));

  section('init + strength commands');
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
  for (const c of setup) {
    const r = cmd(c);
    console.log(`> ${c}`);
    for (const l of r) console.log('  ', l);
    if (r.some((l) => /unknown keyword|incomplete command/i.test(l))) {
      fail(`command not accepted: ${c}`);
    }
  }

  section('show player');
  console.log(cmd('show player').join('\n'));

  section('play a 3-point match');
  const act = (c) => {
    lastBoard = null;
    return cmd(c);
  };
  act('new match 3');
  let moves = 0;
  let quiet = 0;
  let finalScore = null;
  for (let i = 0; i < 5000; i++) {
    const cur = lastBoard ? parseBoard(lastBoard) : null;
    if (cur && (cur.myScore >= cur.matchLength || cur.oppScore >= cur.matchLength)) {
      finalScore = cur;
      break;
    }
    if (resignOffered) {
      resignOffered = false;
      act('accept');
      continue;
    }
    const b = lastBoard ? parseBoard(lastBoard) : null;
    if (!b) {
      const produced = nextTurn();
      if (produced.length === 0) {
        quiet++;
        if (quiet % 4 === 3) cmd('show board');
        if (quiet > 40) fail('engine went quiet with no board');
      } else {
        quiet = 0;
      }
      continue;
    }
    quiet = 0;
    if (b.wasDoubled) {
      act('take');
      continue;
    }
    if (b.turn === 1 && b.dice[0] > 0) {
      const hintOut = cmd('hint 5');
      if (!dumpedMoveHint) {
        dumpedMoveHint = true;
        section('raw move hint output');
        console.log(hintOut.join('\n'));
        section('continue playing');
      }
      const joined = hintOut.join('\n');
      const m = /^\s*1\.\s+(?:Cubeful|Cubeless)\s+\S+\s+(.+?)\s+(?:Eq\.|MWC):/m.exec(joined);
      if (m) {
        const r = act('move ' + m[1].trim());
        if (r.some((l) => /illegal|invalid/i.test(l))) fail(`move rejected: ${m[1]} -> ${r.join(' ')}`);
        moves++;
      } else {
        act('move');
      }
      continue;
    }
    if (b.turn === 1 && b.dice[0] === 0) {
      if (!dumpedCubeHint && b.iMayDouble && moves > 3) {
        dumpedCubeHint = true;
        section('raw cube hint output');
        console.log(cmd('hint').join('\n'));
        section('continue playing');
      }
      act('roll');
      continue;
    }
    nextTurn();
  }
  console.log('human moves played:', moves);
  console.log('final score:', finalScore ? `${finalScore.myScore}-${finalScore.oppScore} (to ${finalScore.matchLength})` : 'unknown');
  const endLine = allLines.filter((l) => /win|match/i.test(l)).slice(-5);
  console.log('end lines:', endLine);
  if (moves === 0) fail('no human moves were played');
  if (!finalScore) fail('match end not detected by score');

  section('.mat export');
  const r = cmd('export match mat "/m.mat"');
  for (const l of r) console.log('  ', l);
  /* eslint-disable no-undef */
  const mat = FS.readFile('/m.mat', { encoding: 'utf8' });
  console.log(mat.split('\n').slice(0, 15).join('\n'));
  if (!/point match/i.test(mat) && !/Game 1/i.test(mat)) fail('.mat content looks wrong');

  console.log('\nSMOKE OK');
  process.exit(0);
}

const realFetch = global.fetch;
global.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/') && fs.existsSync(url)) {
    const buf = fs.readFileSync(url);
    return Promise.resolve(
      new Response(buf, { headers: { 'Content-Type': 'application/wasm' } }),
    );
  }
  return realFetch(url, opts);
};

global.__dirname = ENGINE_DIR;
global.__filename = path.join(ENGINE_DIR, 'gnubg.js');
global.require = require;
global.location = { pathname: '/engine/gnubg.js', href: '/engine/gnubg.js' };
global.XMLHttpRequest = class {
  open(_method, url) {
    this.url = url;
  }
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
