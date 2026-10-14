/**
 * Сессии оркестраторов («ящики»): хранение (sessions.json), создание, правка, закрытие и удаление.
 * Каждый Claude заводит свою сессию, агенты привязываются к ней, у сессии свой inbox (курсор — в ленте).
 * Правила полей — domain/sessions.ts.
 */
import type { LeadState, SessionPatch, SessionRequest, SessionStatus, SessionView } from '../../../shared/types'
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

	/** Каталог чата Claude этой сессии (из хука) или null. */
	cwdOf(id: string): string | null {
		return this.sessions.get(id)?.cwd ?? null
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

	/**
	 * Привязка чата Claude к сессии: уже привязанная к этому чату (resume) → она; иначе заданная `ref`, если она свободна
	 * (первый запуск в окне приложения); иначе новая сессия (новый чат в том же окне). `source: 'clear'` — продолжение разговора после /clear:
	 * сессия прежняя (с её агентами), меняется только чат. Привязка сохраняется на диск.
	 */
	bind(chatId: string, ref: string | null, title: string, terminal: string | null = null, cwd: string | null = null, source: string | null = null): SessionView {
		const id = chatId.trim()
		if (!id) throw new AppError(400, 'bad_request', 'chatId не задан')
		const free = ref ? this.sessions.get(ref.trim().toLowerCase()) : undefined
		// терминал приложения, в котором идёт чат (из окружения хука): по нему окно находит свою сессию без заранее созданной пустой
		const origin = terminal?.trim() || (free ? (free.origin ?? free.id) : null)
		const hit = [...this.sessions.values()].find(s => s.chatId === id)
		const dir = cwd && cwd.startsWith('/') ? cwd : null
		if (hit) {
			// чат продолжили в другом терминале (/resume) или в другой папке: сессия переезжает
			const move = !!origin && hit.origin !== origin && hit.id !== origin
			if (move || (dir && hit.cwd !== dir)) {
				const moved: SessionView = { ...hit, origin: move ? origin : hit.origin, cwd: dir ?? hit.cwd ?? null }
				this.put(moved)
				return moved
			}
			return hit
		}
		// /clear в том же терминале: чат новый, а разговор тот же — агенты и курсор остаются в прежней сессии, у неё меняется chatId
		if (source === 'clear' && origin) {
			const prev = [...this.sessions.values()]
				.filter(s => s.chatId && s.chatId !== id && (s.origin === origin || s.id === origin))
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
			if (prev) {
				const moved: SessionView = { ...prev, chatId: id, origin, cwd: dir ?? prev.cwd ?? null }
				this.put(moved)
				return moved
			}
		}
		if (free && !free.chatId) {
			const next: SessionView = { ...free, chatId: id, origin, cwd: dir }
			this.put(next)
			return next
		}
		const made = this.create({ title: title || free?.title || 'Главный агент', owner: 'lead' })
		const next: SessionView = { ...made, chatId: id, origin, cwd: dir }
		this.put(next)
		return next
	}

	/** Состояние Claude Code по хукам (в памяти: после рестарта сервиса неизвестно). */
	setLeadState(ref: string, state: LeadState): SessionView {
		const s = this.resolve(ref)
		const next: SessionView = { ...s, lead: { state, at: this.isoNow() } }
		this.sessions.set(s.id, next)
		this.ctx.hub.publish({ t: 'session', session: next }) // без записи на диск: состояние временное
		return next
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
