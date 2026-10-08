/**
 * Orchestrator — центральный класс ядра. Владеет пространствами, агентами и лентой сообщений.
 *
 * Правила маршрутизации (единственное место, где они описаны):
 *  1. you → агент (msg): доставка агенту; по завершении хода ответ уходит в `you` (reply, виден в inbox и ленте).
 *  2. агент A → агент B (msg): доставка B; по завершении хода ответ автоматически уходит A (reply).
 *     Если A отправил с wait=true — ответ вернётся в его shell-вызов и НЕ дублируется ему промптом.
 *  3. Ход, вызванный reply, ответа не порождает (иначе пинг-понг). Дальше агенты общаются явным `send`.
 *  4. Защиты: лимит длины цепочки (hops), лимит сообщений в минуту на пару, детектор дедлоков для wait.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
	AgentEvent,
	AgentView,
	GraphView,
	InboxResponse,
	Message,
	MessageKind,
	NodeId,
	SendRequest,
	SendResponse,
	SpaceRequest,
	SpaceView,
	SpawnRequest,
	SpawnResponse,
	StatusResponse,
	StreamEvent,
} from '../../shared/types'
import { Agent, type AgentHost } from './agent'
import type { Config } from './config'
import { Hub } from './hub'
import { errMsg } from './json'
import { Space } from './space'
import { Store, type PersistedState } from './store'
import { HttpError, PALETTE, YOU, clip, rid } from './util'

const SYSTEM = 'system'
const MAX_MEMORY_MESSAGES = 5000
const SNAPSHOT_MESSAGES = 300
const DEFAULT_WAIT_SEC = 600

export interface PostInput {
	from: NodeId
	to: NodeId
	kind: MessageKind
	text: string
	hops?: number
	replyTo?: string
	wait?: boolean
}

export class Orchestrator implements AgentHost {
	readonly hub = new Hub()
	readonly store: Store
	readonly spaces = new Map<string, Space>()
	readonly agents = new Map<string, Agent>()
	readonly startedAt = Date.now()

	private messages: Message[] = []
	private msgSeq = 0
	private inboxCursor = 0
	private readonly usedPorts = new Set<number>()
	private readonly waiters = new Map<string, (reply: Message) => void>()
	private readonly waitingOn = new Map<string, Set<string>>()
	private readonly rate = new Map<string, number[]>()
	private readonly inboxWaiters = new Set<() => void>()
	private shuttingDown = false

	constructor(
		readonly config: Config,
		store?: Store,
	) {
		this.store = store ?? new Store(config.home)
	}

	// ======================================================================
	// загрузка / сохранение
	// ======================================================================
	load(): void {
		const st = this.store.loadState()
		this.messages = this.store.loadMessages(MAX_MEMORY_MESSAGES)
		this.msgSeq = Math.max(st.msgSeq, ...this.messages.map(m => m.seq), 0)
		this.inboxCursor = st.inboxCursor
		for (const s of st.spaces) {
			this.spaces.set(
				s.name,
				this.makeSpace({
					name: s.name,
					path: s.path,
					url: s.url,
					color: s.color,
				}),
			)
		}
		for (const p of st.agents) {
			if (!this.spaces.has(p.space)) continue
			this.agents.set(
				p.id,
				Agent.restore(p, {
					host: this,
					hub: this.hub,
					store: this.store,
					config: this.config,
				}),
			)
		}
	}

	private persistState(): PersistedState {
		return {
			spaces: [...this.spaces.values()].map(s => ({
				name: s.name,
				path: s.path,
				url: s.url,
				color: s.color,
			})),
			agents: [...this.agents.values()].map(a => a.persist()),
			msgSeq: this.msgSeq,
			inboxCursor: this.inboxCursor,
		}
	}

	saveSoon(): void {
		this.store.saveStateSoon(() => this.persistState())
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true
		for (const a of this.agents.values()) a.detach()
		this.store.saveStateSoon(() => this.persistState())
		this.store.flush()
		await Promise.all(
			[...this.spaces.values()].map(s => s.stop().catch(() => undefined)),
		)
	}

	// ======================================================================
	// пространства
	// ======================================================================
	private makeSpace(init: {
		name: string
		path: string
		url?: string | null
		color?: number
	}): Space {
		return new Space(init, {
			config: this.config,
			hub: this.hub,
			store: this.store,
			usedPorts: this.usedPorts,
			onExit: (space, info) => {
				if (this.shuttingDown || info.intended) return
				const reason = `nessy serve пространства «${space.name}» завершился (code=${info.code}, signal=${info.signal})`
				for (const a of this.agents.values())
					if (a.space === space.name) a.onSpaceDown(reason)
			},
		})
	}

	addSpace(req: SpaceRequest): SpaceView {
		if (!req.path || !path.isAbsolute(req.path))
			throw new HttpError(
				400,
				'bad_path',
				'path должен быть абсолютным путём к воркспейсу',
			)
		const p = path.normalize(req.path).replace(/\/+$/, '') || '/'
		if (!fs.existsSync(p) || !fs.statSync(p).isDirectory())
			throw new HttpError(400, 'bad_path', `каталог не найден: ${p}`)
		const existing = [...this.spaces.values()].find(s => s.path === p)
		if (existing) return existing.toJSON()
		let name = (req.name ?? path.basename(p)) || 'root'
		if (this.spaces.has(name)) {
			if (req.name)
				throw new HttpError(
					409,
					'space_exists',
					`пространство «${name}» уже существует`,
				)
			let i = 2
			while (this.spaces.has(`${name}-${i}`)) i++
			name = `${name}-${i}`
		}
		const color = PALETTE[this.spaces.size % PALETTE.length] ?? 210
		const space = this.makeSpace({ name, path: p, url: req.url ?? null, color })
		this.spaces.set(name, space)
		this.hub.publish({ t: 'space', space: space.toJSON() })
		this.saveSoon()
		return space.toJSON()
	}

	async removeSpace(name: string, force = false): Promise<void> {
		const space = this.spaces.get(name)
		if (!space)
			throw new HttpError(404, 'no_space', `пространство «${name}» не найдено`)
		const inside = [...this.agents.values()].filter(a => a.space === name)
		if (inside.length && !force)
			throw new HttpError(
				409,
				'space_busy',
				`в пространстве ${inside.length} агент(ов); укажите force, чтобы удалить их`,
			)
		for (const a of inside) await this.removeAgent(a.id)
		await space.stop()
		this.spaces.delete(name)
		this.hub.publish({ t: 'space_removed', name })
		this.saveSoon()
	}

	/** Имя пространства, путь или пусто (если пространство единственное). */
	resolveSpace(spec?: string): Space {
		if (!spec) {
			if (this.spaces.size === 1) return [...this.spaces.values()][0] as Space
			throw new HttpError(
				400,
				'space_required',
				this.spaces.size
					? 'укажите пространство (--space): их несколько'
					: 'пространств нет: добавьте `nessy-orch space add <путь>`',
			)
		}
		const byName = this.spaces.get(spec)
		if (byName) return byName
		if (path.isAbsolute(spec)) {
			const norm = path.normalize(spec).replace(/\/+$/, '') || '/'
			const byPath = [...this.spaces.values()].find(s => s.path === norm)
			if (byPath) return byPath
			const v = this.addSpace({ path: norm })
			return this.spaces.get(v.name) as Space
		}
		throw new HttpError(404, 'no_space', `пространство «${spec}» не найдено`)
	}

	getSpace(name: string): Space | undefined {
		return this.spaces.get(name)
	}

	// ======================================================================
	// агенты
	// ======================================================================
	resolveAgent(ref: string): Agent {
		const byId = this.agents.get(ref)
		if (byId) return byId
		const hits = [...this.agents.values()].filter(
			a => a.name.toLowerCase() === ref.toLowerCase(),
		)
		if (hits.length === 1) return hits[0] as Agent
		if (hits.length > 1)
			throw new HttpError(
				409,
				'ambiguous_agent',
				`имя «${ref}» неоднозначно: ${hits.map(a => a.id).join(', ')}`,
			)
		throw new HttpError(404, 'no_agent', `агент «${ref}» не найден`)
	}

	labelOf(id: string): string {
		if (id === YOU) return 'you (главный оператор)'
		const a = this.agents.get(id)
		return a ? (a.name === a.id ? a.id : `${a.name} (${a.id})`) : id
	}

	/** Вводная для нового контекста агента: кто он, кто рядом, как писать другим. */
	preambleFor(agent: Agent): string {
		const peers = [...this.agents.values()].filter(
			a => a.id !== agent.id && a.status !== 'dead',
		)
		const cli = this.config.cliPath
		const lines = [
			`[nessy-orch] Ты — агент «${agent.name}» (id: ${agent.id}) в оркестраторе, пространство «${agent.space}».`,
			`Сообщения тебе приходят от оператора (you) или от других агентов; твой финальный ответ уходит отправителю автоматически.`,
			`Чтобы САМОСТОЯТЕЛЬНО написать другому агенту или оператору, выполни в shell:`,
			`  ${cli} send --from ${agent.id} <кому> "текст"        # асинхронно, ответ придёт тебе сообщением`,
			`  ${cli} send --from ${agent.id} --wait <кому> "текст" # дождаться ответа прямо в выводе команды`,
			`<кому> — id или имя агента, либо «you». Не пересылай сообщения без необходимости: цепочки ограничены.`,
		]
		lines.push(
			peers.length
				? `Другие агенты: ${peers.map(p => `${p.name} (${p.id}, ${p.space})`).join('; ')}.`
				: 'Других агентов пока нет.',
		)
		return lines.join('\n')
	}

	async spawn(req: SpawnRequest): Promise<SpawnResponse> {
		const space = this.resolveSpace(req.space)
		const from = req.from ?? YOU
		if (from !== YOU && !this.agents.has(from))
			throw new HttpError(400, 'bad_from', `неизвестный отправитель: ${from}`)
		const parent = req.parent ?? from
		let id: string
		do id = 'a-' + rid(4)
		while (this.agents.has(id))
		const name = req.name?.trim() || id
		if (
			[...this.agents.values()].some(
				a => a.name.toLowerCase() === name.toLowerCase(),
			)
		) {
			throw new HttpError(409, 'name_taken', `имя «${name}» уже занято`)
		}
		const agent = new Agent(
			{ id, name, space: space.name, parent },
			{ host: this, hub: this.hub, store: this.store, config: this.config },
		)
		this.agents.set(id, agent)
		agent.addSystem(
			`агент создан в пространстве «${space.name}» (${space.path})`,
		)
		agent.publishNode()
		this.postEvent(
			`${this.labelOf(from)} создал агента ${this.labelOf(id)}`,
			id,
		)

		let res: SendResponse | undefined
		if (req.prompt?.trim()) {
			res = await this.send(id, {
				from,
				text: req.prompt,
				wait: req.wait,
				waitTimeoutSec: req.waitTimeoutSec,
			})
		} else {
			void agent.ensureAttached().catch(() => undefined)
		}
		const out: SpawnResponse = {
			agent: agent.toJSON(),
			message: res?.message as Message,
		}
		if (res?.reply) out.reply = res.reply
		if (res?.timedOut) out.timedOut = true
		return out
	}

	async removeAgent(ref: string): Promise<void> {
		const agent = this.resolveAgent(ref)
		await agent.cancel().catch(() => undefined)
		await agent.close().catch(() => undefined)
		this.agents.delete(agent.id)
		this.waitingOn.delete(agent.id)
		this.store.archiveAgent(agent.id)
		this.hub.publish({ t: 'agent_removed', id: agent.id })
		this.postEvent(`агент ${this.labelOf(agent.id)} удалён`, agent.id)
		this.saveSoon()
	}

	async cancelAgent(ref: string): Promise<AgentView> {
		const agent = this.resolveAgent(ref)
		await agent.cancel()
		return agent.toJSON()
	}

	async resolvePermission(
		ref: string,
		requestId: string,
		approve: boolean,
	): Promise<boolean> {
		return this.resolveAgent(ref).resolvePermission(requestId, approve)
	}

	// ======================================================================
	// сообщения
	// ======================================================================
	private append(input: PostInput & { failed?: string }): Message {
		const msg: Message = {
			seq: ++this.msgSeq,
			id: 'm-' + rid(6),
			ts: Date.now(),
			from: input.from,
			to: input.to,
			kind: input.kind,
			text: input.text,
			hops: input.hops ?? 0,
		}
		if (input.replyTo) msg.replyTo = input.replyTo
		if (input.wait) msg.wait = true
		if (input.failed) msg.failed = input.failed
		this.messages.push(msg)
		if (this.messages.length > MAX_MEMORY_MESSAGES)
			this.messages.splice(0, this.messages.length - MAX_MEMORY_MESSAGES)
		this.store.appendMessage(msg)
		this.hub.publish({ t: 'message', message: msg })
		this.saveSoon()
		if (msg.to === YOU) for (const wake of [...this.inboxWaiters]) wake()
		const waiter = msg.replyTo ? this.waiters.get(msg.replyTo) : undefined
		if (waiter && msg.kind === 'reply') waiter(msg)
		return msg
	}

	/** Системная запись в ленте (создание/удаление агентов, ошибки доставки). */
	postEvent(text: string, about?: string): Message {
		return this.append({
			from: SYSTEM,
			to: about ?? SYSTEM,
			kind: 'event',
			text,
		})
	}

	/** Отправить сообщение и доставить адресату. Единая точка входа для всех маршрутов. */
	post(input: PostInput): Message {
		if (input.to === YOU) return this.append(input)
		const target = this.agents.get(input.to)
		if (!target)
			throw new HttpError(404, 'no_agent', `агент «${input.to}» не найден`)
		const hops = input.hops ?? 0
		if (input.from !== YOU && input.from !== SYSTEM) {
			if (hops > this.config.maxHops) {
				throw new HttpError(
					429,
					'hop_limit',
					`цепочка сообщений длиннее ${this.config.maxHops} — вероятно, зацикливание; сообщение отклонено`,
				)
			}
			this.checkRate(input.from, input.to)
		}
		const msg = this.append(input)
		if (!(input.kind === 'reply' && input.wait)) target.deliver(msg)
		return msg
	}

	private checkRate(from: string, to: string): void {
		const key = `${from}>${to}`
		const now = Date.now()
		const arr = (this.rate.get(key) ?? []).filter(t => now - t < 60000)
		if (arr.length >= this.config.rateLimitPerMinute) {
			throw new HttpError(
				429,
				'rate_limit',
				`слишком много сообщений ${from} → ${to} (лимит ${this.config.rateLimitPerMinute}/мин)`,
			)
		}
		arr.push(now)
		this.rate.set(key, arr)
	}

	/** Отправить сообщение агенту от `you` или от другого агента; опционально дождаться ответа. */
	async send(ref: string, req: SendRequest): Promise<SendResponse> {
		const text = (req.text ?? '').trim()
		if (!text) throw new HttpError(400, 'empty_text', 'text обязателен')
		const to = ref === YOU ? YOU : this.resolveAgent(ref).id
		const from = req.from ?? YOU
		if (from !== YOU && !this.agents.has(from))
			throw new HttpError(400, 'bad_from', `неизвестный отправитель: ${from}`)
		if (from === to)
			throw new HttpError(
				400,
				'self_send',
				'нельзя отправить сообщение самому себе',
			)

		const wait = !!req.wait
		if (wait && from !== YOU && to !== YOU) this.assertNoDeadlock(from, to)
		const sender = from === YOU ? null : this.agents.get(from)
		const hops = sender ? (sender.currentMessage?.hops ?? 0) + 1 : 0

		const message = this.post({ from, to, kind: 'msg', text, hops, wait })
		if (!wait) return { message }
		return this.waitReply(message, from, to, req.waitTimeoutSec)
	}

	private async waitReply(
		message: Message,
		from: string,
		to: string,
		timeoutSec?: number,
	): Promise<SendResponse> {
		const timeoutMs = Math.max(1, timeoutSec ?? DEFAULT_WAIT_SEC) * 1000
		if (from !== YOU) {
			const set = this.waitingOn.get(from) ?? new Set<string>()
			set.add(to)
			this.waitingOn.set(from, set)
		}
		try {
			const reply = await new Promise<Message | null>(resolve => {
				const timer = setTimeout(() => {
					this.waiters.delete(message.id)
					resolve(null)
				}, timeoutMs)
				this.waiters.set(message.id, r => {
					clearTimeout(timer)
					this.waiters.delete(message.id)
					resolve(r)
				})
			})
			return reply ? { message, reply } : { message, timedOut: true }
		} finally {
			this.waitingOn.get(from)?.delete(to)
		}
	}

	/** A ждёт B; если B (транзитивно) уже ждёт A — оба зависнут навсегда. */
	private assertNoDeadlock(from: string, to: string): void {
		const seen = new Set<string>()
		const stack = [to]
		while (stack.length) {
			const cur = stack.pop() as string
			if (cur === from)
				throw new HttpError(
					409,
					'deadlock',
					`взаимное ожидание ${from} ↔ ${to}: используйте send без --wait`,
				)
			if (seen.has(cur)) continue
			seen.add(cur)
			for (const nxt of this.waitingOn.get(cur) ?? []) stack.push(nxt)
		}
	}

	// ---------- коллбэки агентов ----------
	onTurnDone(
		agent: Agent,
		msg: Message,
		text: string,
		info: { error?: string; stopReason?: string },
	): void {
		if (msg.kind === 'reply' || msg.from === SYSTEM) return // ответы на ответы не порождаем
		const body = info.error
			? `⚠ ошибка: ${info.error}${text ? `\n\n${text}` : ''}`
			: text || '(пустой ответ)'
		this.append({
			from: agent.id,
			to: msg.from,
			kind: 'reply',
			text: body,
			hops: msg.hops + 1,
			replyTo: msg.id,
			wait: msg.wait,
			failed: info.error,
		})
		const back = this.agents.get(msg.from)
		if (back && !msg.wait)
			back.deliver(this.messages[this.messages.length - 1] as Message)
	}

	onUndeliverable(agent: Agent, msg: Message, reason: string): void {
		this.postEvent(
			`сообщение ${this.labelOf(msg.from)} → ${this.labelOf(agent.id)} не доставлено: ${reason}`,
			agent.id,
		)
		this.onTurnDone(agent, msg, '', { error: reason })
	}

	// ======================================================================
	// чтение
	// ======================================================================
	graph(): GraphView {
		return {
			rev: this.hub.rev,
			spaces: [...this.spaces.values()].map(s => s.toJSON()),
			agents: [...this.agents.values()].map(a => a.toJSON()),
		}
	}

	snapshot(): Extract<StreamEvent, { t: 'snapshot' }> {
		return {
			t: 'snapshot',
			...this.graph(),
			messages: this.messages.slice(-SNAPSHOT_MESSAGES),
		}
	}

	listMessages(
		opts: { agent?: string; since?: number; limit?: number } = {},
	): Message[] {
		let list = this.messages
		if (opts.agent) {
			const id = this.resolveAgent(opts.agent).id
			list = list.filter(m => m.from === id || m.to === id)
		}
		if (opts.since !== undefined)
			list = list.filter(m => m.seq > (opts.since as number))
		return list.slice(-(opts.limit ?? 200))
	}

	/** История чата агента: события из файла (последняя запись с тем же seq побеждает) + незавершённый блок. */
	agentHistory(ref: string, limit = 400): AgentEvent[] {
		const agent = this.resolveAgent(ref)
		const bySeq = new Map<number, AgentEvent>()
		for (const e of this.store.readEvents(agent.id, 4000)) bySeq.set(e.seq, e)
		const live = agent.liveRun()
		if (live)
			bySeq.set(live.seq, {
				seq: live.seq,
				ts: live.ts,
				kind: live.kind,
				text: live.text,
			})
		return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-limit)
	}

	getAgent(ref: string): AgentView {
		return this.resolveAgent(ref).toJSON()
	}

	/** Входящие для `you`. peek=true не двигает курсор. wait — long-poll (сек). */
	async inbox(
		opts: { wait?: number; peek?: boolean; after?: number } = {},
	): Promise<InboxResponse> {
		const read = (): Message[] =>
			this.messages.filter(
				m =>
					m.to === YOU &&
					m.kind === 'reply' &&
					m.seq > (opts.after ?? this.inboxCursor),
			)
		let list = read()
		const waitSec = opts.wait ?? 0
		if (!list.length && waitSec > 0) {
			await new Promise<void>(resolve => {
				const done = (): void => {
					clearTimeout(timer)
					this.inboxWaiters.delete(done)
					resolve()
				}
				const timer = setTimeout(done, waitSec * 1000)
				this.inboxWaiters.add(done)
			})
			list = read()
		}
		const cursor = list.length
			? (list[list.length - 1] as Message).seq
			: (opts.after ?? this.inboxCursor)
		if (!opts.peek && opts.after === undefined && list.length) {
			this.inboxCursor = cursor
			this.saveSoon()
		}
		return { messages: list, cursor }
	}

	status(version: string): StatusResponse {
		const agents = [...this.agents.values()]
		return {
			version,
			pid: process.pid,
			uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
			rev: this.hub.rev,
			home: this.config.home,
			autoApprove: this.config.autoApprove,
			spaces: this.spaces.size,
			agents: agents.length,
			working: agents.filter(a => a.status === 'working').length,
		}
	}
}

export { clip, errMsg }
