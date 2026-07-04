/// <reference lib="webworker" />
import type { EngineRequest, EngineResponse, EngineEvent } from './types';
import { parseBoard } from './parse';

const g = globalThis as unknown as Record<string, any>;
const post = (msg: { event?: EngineEvent; response?: EngineResponse }) =>
  (globalThis as unknown as Worker).postMessage(msg);

let outBuf: string[] = [];
let started = false;

const NOISE = [
  'falling back to ArrayBuffer instantiation',
  'wasm streaming compile failed',
  'file packager has copied file data into memory',
];

function onLine(str: string) {
  if (NOISE.some((n) => str.startsWith(n))) return;
  if (str.startsWith('board:')) {
    try {
      post({ event: { type: 'board', state: parseBoard(str) } });
    } catch (e) {
      console.debug('board parse failed', e, str);
    }
    outBuf.push(str);
    return;
  }
  if (str.includes('offers to resign')) {
    const value = str.endsWith('a gammon.') ? 2 : str.endsWith('a backgammon.') ? 3 : 1;
    post({ event: { type: 'resignOffer', value } });
  }
  outBuf.push(str);
  post({ event: { type: 'line', text: str } });
}

let stdinPending = '';
let stdinIdx = 0;
function stdinFn(): number | null {
  if (stdinIdx >= stdinPending.length) {
    if (stdinPending === '') {
      stdinPending = 'y\n';
      stdinIdx = 0;
    } else {
      stdinPending = '';
      stdinIdx = 0;
      return null;
    }
  }
  return stdinPending.charCodeAt(stdinIdx++);
}

let cmdBuf = 0;
function writeCommand(text: string) {
  const M = g.Module;
  if (!cmdBuf) cmdBuf = M._malloc(4096);
  const n = Math.min(text.length, 4095);
  for (let i = 0; i < n; i++) M.setValue(cmdBuf + i, text.charCodeAt(i) & 0x7f, 'i8');
  M.setValue(cmdBuf + n, 0, 'i8');
}

function runCommand(text: string): string[] {
  outBuf = [];
  writeCommand(text);
  g.Module._run_command(cmdBuf);
  return outBuf;
}

function nextTurn(): string[] {
  outBuf = [];
  g.Module._doNextTurn();
  return outBuf;
}

const INIT_COMMANDS = [
  'set confirm new off',
  'set confirm save off',
  'set output mwc off',
  'set automatic game on',
];

g.Module = {
  print: onLine,
  printErr: onLine,
  locateFile: (path: string) => '/engine/' + path,
  preRun: [
    () => {
      g.FS.init(stdinFn, null, null);
    },
  ],
  onRuntimeInitialized: () => {
    g.Module._start();
    for (const cmd of INIT_COMMANDS) runCommand(cmd);
    started = true;
    post({ event: { type: 'ready' } });
    flushQueue();
  },
};

const queue: EngineRequest[] = [];

function handle(req: EngineRequest) {
  try {
    if (req.cmd.type === 'command') {
      post({ response: { id: req.id, ok: true, lines: runCommand(req.cmd.text) } });
    } else if (req.cmd.type === 'nextTurn') {
      post({ response: { id: req.id, ok: true, lines: nextTurn() } });
    } else if (req.cmd.type === 'writeFile') {
      g.FS.writeFile(req.cmd.path, req.cmd.contents);
      post({ response: { id: req.id, ok: true } });
    } else {
      const file = g.FS.readFile(req.cmd.path, { encoding: 'utf8' }) as string;
      post({ response: { id: req.id, ok: true, file } });
    }
  } catch (e) {
    post({ response: { id: req.id, ok: false, error: String(e) } });
  }
}

function flushQueue() {
  while (queue.length > 0) handle(queue.shift()!);
}

globalThis.onmessage = (ev: MessageEvent<EngineRequest>) => {
  if (!started) {
    queue.push(ev.data);
    return;
  }
  handle(ev.data);
};

fetch('/engine/gnubg.js')
  .then((r) => {
    if (!r.ok) throw new Error(`engine fetch failed: ${r.status}`);
    return r.text();
  })
  .then((src) => {
    (0, eval)(src);
  })
  .catch((e) => {
    post({ event: { type: 'crashed', error: String(e) } });
  });
