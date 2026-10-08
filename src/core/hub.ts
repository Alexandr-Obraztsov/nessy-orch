import type { HubEvent, HubInput } from '../../shared/types';

type Listener = (evt: HubEvent) => void;

/**
 * Hub — единая шина событий оркестратора.
 * Публикуют: Space, Agent, Orchestrator. Читают: API (/stream), UI, CLI.
 */
export class Hub {
  rev = 0;
  private readonly subs = new Set<Listener>();

  publish(input: HubInput): HubEvent {
    const evt = { ...input, rev: ++this.rev } as HubEvent;
    for (const fn of this.subs) {
      try {
        fn(evt);
      } catch {
        /* подписчик не должен ломать шину */
      }
    }
    return evt;
  }

  subscribe(fn: Listener): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
}
