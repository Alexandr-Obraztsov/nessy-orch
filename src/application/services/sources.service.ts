/**
 * Источники сессий: всё, на что ссылались агенты, — ссылки из итоговых ответов («Источники») и из вызовов инструментов.
 * Хранится построчно (sources/<сессия>.jsonl), в памяти — по сессиям с дедупликацией; счётчик уходит в SessionView.
 */
import type { SourceView } from '../../../shared/types'
import { parseReply } from '../../domain/reply'
import type { SourceChip } from '../../domain/reply'
import { sourceKey, urlChips } from '../../domain/sources'
import type { ServiceContext } from './context.types'
import type { SessionsService } from './sessions.service'

interface Bucket {
	items: SourceView[]
	keys: Set<string>
}

export class SourcesService {
	private readonly buckets = new Map<string, Bucket>()

	constructor(
		private readonly ctx: ServiceContext,
		private readonly sessions: SessionsService,
	) {}

	private bucket(sessionId: string): Bucket {
		let b = this.buckets.get(sessionId)
		if (!b) {
			const items = this.ctx.store.loadSources(sessionId)
			b = { items, keys: new Set(items.map(s => keyOfView(s))) }
			this.buckets.set(sessionId, b)
		}
		return b
	}

	list(sessionId: string): SourceView[] {
		this.sessions.resolve(sessionId)
		return [...this.bucket(sessionId).items]
	}

	forget(sessionId: string): void {
		this.buckets.delete(sessionId)
	}

	/** Источники из итогового ответа агента. */
	addFromReply(agentId: string, text: string): void {
		if (!text.trim()) return
		this.add(agentId, parseReply(text).sources, 'reply')
	}

	/** Ссылки из вызова инструмента. */
	addFromTool(agentId: string, urls: readonly string[]): void {
		if (urls.length) this.add(agentId, urlChips(urls), 'tool')
	}

	private add(agentId: string, chips: readonly SourceChip[], origin: SourceView['origin']): void {
		const agent = this.ctx.registry.agents.get(agentId)
		const sessionId = agent?.session
		if (!agent || !sessionId || !this.sessions.has(sessionId)) return
		const b = this.bucket(sessionId)
		let added = 0
		for (const c of chips) {
			const key = sourceKey(c)
			if (b.keys.has(key)) continue
			b.keys.add(key)
			const view: SourceView = {
				id: this.ctx.ids.next(8),
				kind: c.kind,
				label: c.label,
				...(c.kind === 'url' ? { href: c.href, host: c.host } : {}),
				agentId: agent.id,
				agentName: agent.name,
				origin,
				ts: this.ctx.clock.now(),
			}
			b.items.push(view)
			this.ctx.store.appendSource(sessionId, view)
			added++
		}
		if (added) this.sessions.setSourceCount(sessionId, b.items.length)
	}
}

function keyOfView(s: SourceView): string {
	return s.kind === 'url' && s.href ? sourceKey({ kind: 'url', label: s.label, href: s.href, host: s.host ?? '' }) : sourceKey({ kind: 'text', label: s.label })
}
