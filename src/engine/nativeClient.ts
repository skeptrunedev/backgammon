import type { EngineEvent, EngineRequest, EngineResponse } from './types';
import { parseBoard } from './parse';

type EventHandler = (ev: EngineEvent) => void;

// Wire messages coming back from the WebView engine host.
interface WireReady {
  t: 'ready';
}
interface WireCrashed {
  t: 'crashed';
  error: string;
}
interface WireLine {
  t: 'line';
  text: string;
}
interface WireResponse {
  t: 'response';
  id: number;
  ok: boolean;
  lines?: string[];
  file?: string;
  error?: string;
}
type WireMessage = WireReady | WireCrashed | WireLine | WireResponse;

/**
 * Drop-in replacement for the web app's GnubgClient. Instead of a Web Worker it
 * drives the gnubg WASM engine hosted in a hidden WebView (see EngineWebView):
 * requests are injected into the WebView; raw output lines and RPC responses
 * come back over the bridge and are interpreted here into typed engine events —
 * identical semantics to the web engine worker, so shared game code is unchanged.
 */
export class GnubgClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: EngineResponse) => void; reject: (e: Error) => void }
  >();
  private handlers = new Set<EventHandler>();
  private post: ((json: string) => void) | null = null;
  private outbox: string[] = []; // requests queued until the WebView poster attaches
  readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;

  constructor() {
    this.readyPromise = new Promise<void>((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });
  }

  /** Called by EngineWebView once the WebView ref is live. */
  attachPoster(post: (json: string) => void): void {
    this.post = post;
    for (const json of this.outbox) post(json);
    this.outbox = [];
  }

  detachPoster(): void {
    this.post = null;
  }

  /** Called by EngineWebView for every message from the WebView. */
  handleMessage(json: string): void {
    let msg: WireMessage;
    try {
      msg = JSON.parse(json);
    } catch {
      return;
    }
    if (msg.t === 'ready') {
      this.emit({ type: 'ready' });
      this.resolveReady();
    } else if (msg.t === 'crashed') {
      this.emit({ type: 'crashed', error: msg.error });
      this.rejectReady(new Error(msg.error));
    } else if (msg.t === 'line') {
      this.onLine(msg.text);
    } else if (msg.t === 'response') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg);
        else p.reject(new Error(msg.error ?? 'engine error'));
      }
    }
  }

  // Mirror of the web worker's per-line handling: board lines become board
  // events, resignation offers become resignOffer events, everything else a line.
  private onLine(str: string): void {
    if (str.startsWith('board:')) {
      try {
        this.emit({ type: 'board', state: parseBoard(str) });
      } catch {
        /* ignore malformed board line */
      }
      return;
    }
    if (str.includes('offers to resign')) {
      const value = str.endsWith('a gammon.') ? 2 : str.endsWith('a backgammon.') ? 3 : 1;
      this.emit({ type: 'resignOffer', value });
    }
    this.emit({ type: 'line', text: str });
  }

  private emit(ev: EngineEvent): void {
    for (const h of this.handlers) h(ev);
  }

  onEvent(h: EventHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private send(cmd: EngineRequest['cmd']): Promise<EngineResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const json = JSON.stringify({ id, cmd } satisfies EngineRequest);
      if (this.post) this.post(json);
      else this.outbox.push(json);
    });
  }

  async command(text: string): Promise<string[]> {
    return (await this.send({ type: 'command', text })).lines ?? [];
  }

  async nextTurn(): Promise<string[]> {
    return (await this.send({ type: 'nextTurn' })).lines ?? [];
  }

  async readFile(path: string): Promise<string> {
    return (await this.send({ type: 'readFile', path })).file ?? '';
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.send({ type: 'writeFile', path, contents });
  }
}

let shared: GnubgClient | null = null;
export function getEngine(): GnubgClient {
  if (!shared) shared = new GnubgClient();
  return shared;
}
