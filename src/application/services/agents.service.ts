/** Жизненный цикл агентов: создание, удаление, прерывание, архив, разрешения, история чата. */
import type { AgentEvent, AgentView, Message, PlanRequest, SendResponse, SpawnBatchItem, SpawnBatchRequest, SpawnBatchResponse, SpawnRequest, SpawnResponse } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { uniqueName } from '../../domain/naming'
import { validatePlanEntries } from '../../domain/plan'
import { buildPreamble } from '../../domain/preamble'
import type { AgentIdentity, PeerInfo } from '../../domain/types'
import { Agent } from '../agent/agent'
import type { ServiceContext } from './context.types'
import type { MessagingService } from './messaging.service'
import type { RolesService } from './roles.service'
import type { SpacesService } from './spaces.service'
import type { SessionsService } from './sessions.service'

export class AgentsService {
	constructor(
		private readonly ctx: ServiceContext,
		private readonly spaces: SpacesService,
		private readonly messaging: MessagingService,
		private readonly roles: RolesService,
		private readonly sessions: SessionsService,
	) {}

	/** Вводная для нового контекста агента: соседи (архивные помечены) и инструкции роли. */
	preambleFor(agent: AgentIdentity): string {
		const peers: PeerInfo[] = [...this.ctx.registry.agents.values()]
			.filter(a => a.id !== agent.id)
			.map(a => ({ id: a.id, name: a.name, space: a.space, archived: a.archived, roleName: this.roles.find(a.role)?.name ?? null }))
		const role = this.roles.find(this.ctx.registry.agents.get(agent.id)?.role ?? null)
		const key = this.ctx.settings.authRequired ? this.ctx.registry.agents.get(agent.id)?.key : undefined
		return buildPreamble(agent, peers, this.ctx.settings.cliPath, role && { name: role.name, instructions: role.instructions }, key)
	}

	async spawn(req: SpawnRequest): Promise<SpawnResponse> {
		const { registry } = this.ctx
		const from = registry.resolveSender(req.from)
		const parent = req.parent ?? from
		const role = req.role?.trim() ? this.roles.resolve(req.role) : null
		// сессия: явная (проверяем существование) или сессия родителя — агент, запущенный агентом, наследует её
		const session = req.session?.trim() ? this.sessions.resolve(req.session).id : (registry.agents.get(parent)?.session ?? null)
		// без --space агент запускается в каталоге оркестратора — там, где идёт чат Claude (cwd сессии), отдельные каталоги не создаются
		const space = this.spaces.resolve(req.space, (session ? this.sessions.cwdOf(session) : null) ?? req.cwd)
		this.assertBudget(parent, session)
		let id: string
		do id = 'a-' + this.ctx.ids.next(4)
		while (registry.agents.has(id))
		const explicit = req.name?.trim()
		// с ролью и без имени: имя = id роли (reviewer, reviewer-2, …)
		const name = explicit || (role ? uniqueName(role.id, n => registry.isNameTaken(n)) : id)
		if (registry.isNameTaken(name)) throw new AppError(409, 'name_taken', `имя «${name}» уже занято`)

		const agent = new Agent({ id, name, space: space.name, parent, session, role: role?.id ?? null }, this.ctx.agentDeps)
		registry.agents.set(id, agent)
		agent.addSystem(`агент создан в пространстве «${space.name}» (${space.path})${role ? `, роль «${role.name}»` : ''}${session ? `, сессия «${session}»` : ''}`)
		agent.publishNode()
		this.messaging.postEvent(`${registry.labelOf(from)} создал агента ${registry.labelOf(id)}`, id)

		let res: SendResponse | undefined
		if (req.prompt?.trim()) {
			try {
				res = await this.messaging.send(id, { from, text: req.prompt, interrupt: false, wait: req.wait, waitTimeoutSec: req.waitTimeoutSec })
			} catch (e) {
				// отправка поручения отклонена (лимит цепочек, частоты, взаимное ожидание): агент без поручения не оставляем — повтор создал бы дубль
				await this.remove(id).catch(() => undefined)
				throw e
			}
		} else {
			void agent.ensureAttached().catch(() => undefined)
		}
		const out: SpawnResponse = { agent: agent.toJSON(), message: res?.message as Message }
		if (res?.reply) out.reply = res.reply
		if (res?.timedOut) out.timedOut = true
		return out
	}

	/** Глубина порождения: 0 — запущен оператором (или главным агентом), 1 — агентом, запущенным оператором, и т. д. */
	depthOf(parent: string): number {
		let depth = 0
		const seen = new Set<string>()
		for (let p = this.ctx.registry.agents.get(parent); p && !seen.has(p.id); p = this.ctx.registry.agents.get(p.parent)) {
			seen.add(p.id)
			depth++
		}
		return depth
	}

	/** Бюджеты порождения: глубина, число одновременно работающих и общее число агентов сессии. 429 с подсказкой, что делать. */
	private assertBudget(parent: string, session: string | null): void {
		const s = this.ctx.settings
		const maxDepth = s.maxDepth ?? 2
		if (this.depthOf(parent) > maxDepth)
			throw new AppError(429, 'depth_exceeded', `агент не может порождать агентов глубже ${maxDepth} уровней: выполни поручение сам или верни результат запустившему`)
		if (!session) return
		const mine = [...this.ctx.registry.agents.values()].filter(a => a.session === session)
		const active = mine.filter(a => a.isBusy || a.queue.length > 0 || a.status === 'starting').length
		const maxActive = s.maxActivePerSession ?? 12
		if (active >= maxActive)
			throw new AppError(429, 'too_many_active', `в сессии уже работают ${active} агентов (лимит ${maxActive}): дождись ответов (inbox) или останови лишних (cancel)`)
		const maxAll = s.maxAgentsPerSession ?? 40
		if (mine.length >= maxAll)
			throw new AppError(429, 'too_many_agents', `в сессии уже ${mine.length} агентов (лимит ${maxAll}): удали завершённых (kill) или переиспользуй их — сообщение будит агента с прежним контекстом`)
	}

	/**
	 * Автоудаление: завершённые (архивные) агенты, которым никто не писал дольше `agentTtlMs`, удаляются целиком (история уходит в архив
	 * на диск, сессия nessy закрыта). Возвращает, сколько удалено.
	 */
	async collectGarbage(now = this.ctx.clock.now()): Promise<number> {
		const ttl = this.ctx.settings.agentTtlMs ?? 6 * 3_600_000
		if (ttl <= 0) return 0
		const old = [...this.ctx.registry.agents.values()].filter(a => a.archived && !a.isBusy && a.queue.length === 0 && now - Date.parse(a.lastActivityAt) > ttl)
		for (const a of old) await this.remove(a.id).catch(() => undefined)
		return old.length
	}

	/**
	 * Пакет агентов за один вызов: общие поля (space, cwd, session, from) применяются к каждому, ошибка одного не мешает остальным.
	 * Агенты создаются по порядку (имена уникальны), поручения уходят сразу: `wait` в пакете не поддерживается.
	 */
	async spawnMany(req: SpawnBatchRequest): Promise<SpawnBatchResponse> {
		const results: SpawnBatchItem[] = []
		for (const a of req.agents) {
			try {
				const r = await this.spawn({
					...a,
					space: a.space ?? req.space,
					cwd: a.cwd ?? req.cwd,
					session: a.session ?? req.session,
					from: a.from ?? req.from,
					wait: false,
				})
				results.push({ ok: true, agent: r.agent, message: r.message })
			} catch (e) {
				const err = e instanceof AppError ? e : new AppError(500, 'internal', e instanceof Error ? e.message : String(e))
				results.push({ ok: false, error: err.message, code: err.code, ...(a.name ? { name: a.name } : {}) })
			}
		}
		return { results }
	}

	async remove(ref: string): Promise<void> {
		const { registry } = this.ctx
		const agent = registry.resolveAgent(ref)
		await agent.cancel().catch(() => undefined)
		agent.forceFinish()
		await agent.close().catch(() => undefined)
		registry.agents.delete(agent.id)
		this.messaging.forget(agent.id)
		this.ctx.store.archiveAgent(agent.id)
		this.ctx.hub.publish({ t: 'agent_removed', id: agent.id })
		this.messaging.postEvent(`агент ${registry.labelOf(agent.id)} удалён`, agent.id)
		this.ctx.saveSoon()
	}

	async cancel(ref: string): Promise<AgentView> {
		const agent = this.ctx.registry.resolveAgent(ref)
		await agent.cancel()
		return agent.toJSON()
	}

	/** Убрать в архив вручную: только пока агент не работает и очередь пуста, иначе 409 busy. */
	archive(ref: string): AgentView {
		const agent = this.ctx.registry.resolveAgent(ref)
		if (agent.isBusy || agent.queue.length)
			throw new AppError(409, 'busy', `агент ${this.ctx.registry.labelOf(agent.id)} работает — прервите ход (cancel) или дождитесь ответа`)
		agent.setArchived(true)
		return agent.toJSON()
	}

	/** Вернуть из архива без сообщения. */
	restore(ref: string): AgentView {
		const agent = this.ctx.registry.resolveAgent(ref)
		agent.setArchived(false)
		return agent.toJSON()
	}

	/**
	 * План агента: заменить целиком (entries) или убрать (null). План пишет сам агент:
	 * `from` (если указан) должен быть id этого агента, иначе 403 forbidden.
	 */
	setPlan(ref: string, req: Pick<PlanRequest, 'from'> & { entries: unknown }): AgentView {
		const agent = this.ctx.registry.resolveAgent(ref)
		if (req.from !== undefined && req.from !== agent.id)
			throw new AppError(403, 'forbidden', `план агента ${agent.id} может менять только он сам (from=${req.from})`)
		agent.setPlan(req.entries === null ? null : validatePlanEntries(req.entries), 'cli')
		return agent.toJSON()
	}

	resolvePermission(ref: string, requestId: string, approve: boolean): Promise<boolean> {
		return this.ctx.registry.resolveAgent(ref).resolvePermission(requestId, approve)
	}

	/**
	 * История чата агента: события из хранилища (последняя запись с тем же seq побеждает).
	 * includeLive — добавить незавершённый блок текста (для REST); поток отдаёт его отдельным chunk.
	 */
	history(ref: string, limit = 400, includeLive = true): AgentEvent[] {
		const agent = this.ctx.registry.resolveAgent(ref)
		const bySeq = new Map<number, AgentEvent>()
		for (const e of this.ctx.store.readEvents(agent.id, 4000)) bySeq.set(e.seq, e)
		const live = agent.liveRun()
		if (live) {
			if (includeLive) bySeq.set(live.seq, { seq: live.seq, ts: live.ts, kind: live.kind, text: live.text })
			else bySeq.delete(live.seq)
		}
		return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-limit)
	}
}
