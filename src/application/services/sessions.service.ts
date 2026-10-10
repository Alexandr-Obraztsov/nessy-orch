/**
 * Сессии оркестраторов («ящики»): хранение (sessions.json), создание, правка, закрытие и удаление.
 * Каждый Claude заводит свою сессию, агенты привязываются к ней, у сессии свой inbox (курсор — в ленте).
 * Правила полей — domain/sessions.ts.
 */
import type { SessionPatch, SessionRequest, SessionStatus, SessionView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { isSessionId, sessionIdFrom, validateSessionPatch, validateSessionRequest } from '../../domain/sessions'
import { hexId } from '../../lib/ids'
import type { ServiceContext } from './context.types'

export class SessionsService {
	private readonly sessions = new Map<string, SessionView>()

	constructor(
		private readonly ctx: ServiceContext,
		/** суффикс id сессии (по умолчанию 4 hex) — подменяется в тестах */
		private readonly suffix: () => string = () => hexId(4),
	) {}

	load(): void {
		this.sessions.clear()
		for (const t of this.ctx.store.loadSessions()) if (isSessionId(t.id)) this.sessions.set(t.id, t)
	}

	get count(): number {
		return this.sessions.size
	}

	/** Сессии: сначала активные, внутри — по свежести (updatedAt). */
	list(status?: SessionStatus): SessionView[] {
		return [...this.sessions.values()]
			.filter(t => status === undefined || t.status === status)
			.sort((a, b) => (a.status === b.status ? b.updatedAt.localeCompare(a.updatedAt) : a.status === 'active' ? -1 : 1))
	}

	has(id: string): boolean {
		return this.sessions.has(id)
	}

	/** Сессия по id; неизвестная → 404 no_session. */
	resolve(ref: string): SessionView {
		const hit = this.sessions.get(ref.trim().toLowerCase())
		if (!hit) throw new AppError(404, 'no_session', `сессия «${ref}» не найдена`)
		return hit
	}

	create(req: SessionRequest): SessionView {
		const f = validateSessionRequest(req)
		let id = f.id
		if (id !== null) {
			if (this.sessions.has(id)) throw new AppError(409, 'session_exists', `сессия с id «${id}» уже есть`)
		} else {
			do id = sessionIdFrom(f.title, this.suffix())
			while (this.sessions.has(id))
		}
		const now = this.isoNow()
		const session: SessionView = { id, title: f.title, owner: f.owner, status: 'active', summary: null, createdAt: now, updatedAt: now, sources: 0 }
		this.put(session)
		return session
	}

	/** Частичная правка: заголовок, статус (done ставит оркестратор), итог. */
	update(ref: string, patch: SessionPatch): SessionView {
		const prev = this.resolve(ref)
		const p = validateSessionPatch(patch)
		const session: SessionView = {
			...prev,
			title: p.title ?? prev.title,
			status: p.status ?? prev.status,
			summary: p.summary !== undefined ? p.summary : prev.summary,
			updatedAt: this.isoNow(),
		}
		this.put(session)
		return session
	}

	/**
	 * Удалить сессию: только если в ней нет работающих агентов (иначе 409 session_busy).
	 * Агенты сессии остаются, но отвязываются от неё (session = null); курсор inbox сессии забывается.
	 */
	remove(ref: string): void {
		const session = this.resolve(ref)
		const { registry } = this.ctx
		const inside = [...registry.agents.values()].filter(a => a.session === session.id)
		const busy = inside.filter(a => a.isBusy || a.queue.length)
		if (busy.length)
			throw new AppError(
				409,
				'session_busy',
				`в сессии работают агенты: ${busy.map(a => registry.labelOf(a.id)).join(', ')} — прервите их (cancel) или дождитесь ответа`,
			)
		this.sessions.delete(session.id)
		this.save()
		for (const a of inside) a.setSession(null)
		this.ctx.feed.forgetSession(session.id)
		this.ctx.hub.publish({ t: 'session_removed', id: session.id })
	}

	/** Обновить счётчик источников (updatedAt не трогаем — это не действие оператора). */
	setSourceCount(id: string, n: number): void {
		const s = this.sessions.get(id)
		if (s && s.sources !== n) this.put({ ...s, sources: n })
	}

	private put(session: SessionView): void {
		this.sessions.set(session.id, session)
		this.save()
		this.ctx.hub.publish({ t: 'session', session })
	}

	private save(): void {
		this.ctx.store.saveSessions([...this.sessions.values()])
	}

	private isoNow(): string {
		return new Date(this.ctx.clock.now()).toISOString()
	}
}
