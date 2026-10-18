/**
 * FileStore — персистентность оркестратора (JSONL + state.json), без зависимостей.
 *
 *   <home>/state.json            пространства, агенты, курсоры
 *   <home>/roles.json            роли субагентов
 *   <home>/sessions.json            сессии оркестраторов
 *   <home>/messages.jsonl        лента сообщений (группчат)
 *   <home>/agents/<id>.jsonl     поток событий агента (мысли, инструменты, текст)
 *   <home>/logs/space-<n>.log    вывод процессов nessy serve
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentEvent, Message, RoleView, SessionView, SourceView } from '../../../shared/types'
import type { PersistedAgent, PersistedSpace, PersistedState } from '../../application/persisted.types'
import type { StorePort } from '../../application/ports'
import { arr, errMsg, isObject, parseJson } from '../../lib/json'
import { appendJsonl, readJsonl, readText, writeAtomic } from './jsonl'

const SAVE_DELAY_MS = 200

export class FileStore implements StorePort {
	readonly agentsDir: string
	readonly logsDir: string
	readonly sourcesDir: string
	private readonly statePath: string
	private readonly msgPath: string
	private readonly rolesPath: string
	private readonly sessionsPath: string
	private saveTimer: NodeJS.Timeout | null = null
	private getState: (() => PersistedState) | null = null
	private closed = false

	constructor(readonly home: string) {
		this.agentsDir = path.join(home, 'agents')
		this.logsDir = path.join(home, 'logs')
		this.sourcesDir = path.join(home, 'sources')
		fs.mkdirSync(this.sourcesDir, { recursive: true })
		fs.mkdirSync(this.agentsDir, { recursive: true })
		fs.mkdirSync(this.logsDir, { recursive: true })
		this.statePath = path.join(home, 'state.json')
		this.msgPath = path.join(home, 'messages.jsonl')
		this.rolesPath = path.join(home, 'roles.json')
		this.sessionsPath = path.join(home, 'sessions.json')
	}

	loadState(): PersistedState {
		const raw = parseJson(readText(this.statePath))
		if (!isObject(raw)) return { spaces: [], agents: [], msgSeq: 0 }
		return {
			spaces: arr(raw['spaces']) as PersistedSpace[],
			// состояния до переименования «задачи → сессии» хранили поле task
			agents: (arr(raw['agents']) as Array<PersistedAgent & { task?: string | null }>).map(a => (a.session === undefined && a.task !== undefined ? { ...a, session: a.task } : a)),
			msgSeq: typeof raw['msgSeq'] === 'number' ? raw['msgSeq'] : 0,
		}
	}

	saveStateSoon(getState: () => PersistedState): void {
		if (this.closed) return
		this.getState = getState
		if (this.saveTimer) return
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null
			this.flush()
		}, SAVE_DELAY_MS)
	}

	flush(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer)
			this.saveTimer = null
		}
		if (!this.getState) return
		const getState = this.getState
		this.safe('состояние', () => writeAtomic(this.statePath, JSON.stringify(getState(), null, 2))) // диск полон или нет прав: работаем дальше, повторим при следующем изменении
	}

	close(): void {
		if (this.closed) return
		this.flush()
		this.closed = true
	}

	hasRoles(): boolean {
		return fs.existsSync(this.rolesPath)
	}

	loadRoles(): RoleView[] {
		const raw = parseJson(readText(this.rolesPath))
		const list = isObject(raw) ? arr(raw['roles']) : arr(raw)
		return list.filter(isRoleView).map(r => ({ ...r, icon: typeof r.icon === 'string' ? r.icon : null }))
	}

	saveRoles(roles: readonly RoleView[]): void {
		if (!this.closed) this.safe('роли', () => writeAtomic(this.rolesPath, JSON.stringify({ roles }, null, 2)))
	}

	loadSessions(): SessionView[] {
		// до переименования чат главного агента лежал в поле chatId
		const legacyChatId = (x: object): string | null => {
			const v = (x as Record<string, unknown>)['chatId']
			return typeof v === 'string' ? v : null
		}
		// до переименования файл назывался tasks.json (ключ tasks)
		const legacy = path.join(this.home, 'tasks.json')
		const path_ = !fs.existsSync(this.sessionsPath) && fs.existsSync(legacy) ? legacy : this.sessionsPath
		const raw = parseJson(readText(path_))
		const list = isObject(raw) ? arr(raw['sessions'] ?? raw['tasks']) : arr(raw)
		return list.filter(isSessionView).map(x => ({ ...x, sources: typeof x.sources === 'number' ? x.sources : 0, lead: null, chatId: typeof x.chatId === 'string' ? x.chatId : legacyChatId(x), cwd: typeof x.cwd === 'string' ? x.cwd : null, transcriptPath: typeof x.transcriptPath === 'string' ? x.transcriptPath : null, ...(x.service === true ? { service: true } : {}) }))
	}

	saveSessions(sessions: readonly SessionView[]): void {
		if (!this.closed) this.safe('сессии', () => writeAtomic(this.sessionsPath, JSON.stringify({ sessions }, null, 2)))
	}

	appendSource(sessionId: string, source: SourceView): void {
		if (!this.closed) this.safe('источник', () => appendJsonl(path.join(this.sourcesDir, `${sessionId}.jsonl`), source))
	}

	removeSources(sessionId: string): void {
		if (!this.closed) this.safe('источники', () => fs.rmSync(path.join(this.sourcesDir, `${sessionId}.jsonl`), { force: true }))
	}

	loadSources(sessionId: string): SourceView[] {
		return readJsonl<SourceView>(path.join(this.sourcesDir, `${sessionId}.jsonl`), 5000)
	}

	appendMessage(m: Message): void {
		if (!this.closed) this.safe('сообщение', () => appendJsonl(this.msgPath, m))
	}

	loadMessages(limit = 5000): Message[] {
		return readJsonl<Message>(this.msgPath, limit)
	}

	appendEvent(agentId: string, ev: AgentEvent): void {
		if (!this.closed) this.safe('событие агента', () => appendJsonl(this.eventsPath(agentId), ev))
	}

	readEvents(agentId: string, limit = 500): AgentEvent[] {
		return readJsonl<AgentEvent>(this.eventsPath(agentId), limit)
	}

	private lastWarn = 0

	/** Сбой записи на диск (диск полон, нет прав) не должен ронять оркестратор и гасить всех агентов: пишем в stderr не чаще раза в минуту. */
	private safe(what: string, fn: () => void): void {
		try {
			fn()
		} catch (e) {
			const now = Date.now()
			if (now - this.lastWarn > 60_000) {
				this.lastWarn = now
				console.error(`[nessy-orch] не удалось записать (${what}): ${errMsg(e)}`)
			}
		}
	}

	archiveAgent(agentId: string): void {
		const p = this.eventsPath(agentId)
		if (fs.existsSync(p)) fs.renameSync(p, p + '.removed')
	}

	logPath(spaceName: string): string {
		return path.join(this.logsDir, `space-${spaceName.replace(/[^\w.-]/g, '_')}.log`)
	}

	private eventsPath(agentId: string): string {
		return path.join(this.agentsDir, agentId + '.jsonl')
	}
}

/** Минимальная проверка записи roles.json (файл могли править руками). */
function isRoleView(v: unknown): v is RoleView {
	return (
		isObject(v) &&
		typeof v['id'] === 'string' &&
		typeof v['name'] === 'string' &&
		typeof v['instructions'] === 'string' &&
		typeof v['description'] === 'string' &&
		typeof v['color'] === 'number' &&
		typeof v['createdAt'] === 'string' &&
		typeof v['updatedAt'] === 'string'
	)
}

/** Минимальная проверка записи sessions.json (файл могли править руками). */
function isSessionView(v: unknown): v is SessionView {
	return (
		isObject(v) &&
		typeof v['id'] === 'string' &&
		typeof v['title'] === 'string' &&
		(v['owner'] === null || typeof v['owner'] === 'string') &&
		(v['status'] === 'active' || v['status'] === 'done') &&
		(v['summary'] === null || typeof v['summary'] === 'string') &&
		typeof v['createdAt'] === 'string' &&
		typeof v['updatedAt'] === 'string'
	)
}
