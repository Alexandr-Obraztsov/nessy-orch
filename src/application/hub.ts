import type { HubEvent, HubInput } from '../../shared/types'
import type { HubListener } from './hub.types'

/**
 * Hub — единая шина событий оркестратора.
 * Публикуют: пространства, агенты, лента. Читают: HTTP-потоки (/stream, /agents/:id/stream).
 */
export class Hub {
	rev = 0
	private readonly subs = new Set<HubListener>()

	publish(input: HubInput): HubEvent {
		const evt: HubEvent = { ...input, rev: ++this.rev }
		for (const fn of this.subs) {
			try {
				fn(evt)
			} catch {
				/* подписчик не должен ломать шину */
			}
		}
		return evt
	}

	subscribe(fn: HubListener): () => void {
		this.subs.add(fn)
		return () => {
			this.subs.delete(fn)
		}
	}
}
