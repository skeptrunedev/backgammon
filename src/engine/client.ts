import type { EngineEvent, EngineRequest, EngineResponse } from './types';

type EventHandler = (ev: EngineEvent) => void;

export class GnubgClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: EngineResponse) => void; reject: (e: Error) => void }
  >();
  private handlers = new Set<EventHandler>();
  readyPromise: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    this.readyPromise = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.worker.onmessage = (
      ev: MessageEvent<{ event?: EngineEvent; response?: EngineResponse }>,
    ) => {
      const { event, response } = ev.data;
      if (event) {
        if (event.type === 'ready') resolveReady();
        if (event.type === 'crashed') rejectReady(new Error(event.error));
        for (const h of this.handlers) h(event);
      }
      if (response) {
        const p = this.pending.get(response.id);
        if (p) {
          this.pending.delete(response.id);
          if (response.ok) p.resolve(response);
          else p.reject(new Error(response.error ?? 'engine error'));
        }
      }
    };
  }

  onEvent(h: EventHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private send(cmd: EngineRequest['cmd']): Promise<EngineResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, cmd } satisfies EngineRequest);
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

  terminate() {
    this.worker.terminate();
  }
}

let shared: GnubgClient | null = null;
export function getEngine(): GnubgClient {
  if (!shared) shared = new GnubgClient();
  return shared;
}
