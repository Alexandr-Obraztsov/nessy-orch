/**
 * FileStore — персистентность оркестратора (JSONL + state.json), без зависимостей.
 *
 *   <home>/state.json            пространства, агенты, курсоры
 *   <home>/roles.json            роли субагентов
 *   <home>/messages.jsonl        лента сообщений (группчат)
 *   <home>/agents/<id>.jsonl     поток событий агента (мысли, инструменты, текст)
 *   <home>/logs/space-<n>.log    вывод процессов nessy serve
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentEvent, Message, RoleView } from '../../../shared/types'
import type { PersistedAgent, PersistedSpace, PersistedState } from '../../application/persisted.types'
import type { StorePort } from '../../application/ports'
import { arr, isObject, parseJson } from '../../lib/json'
import { appendJsonl, readJsonl, readText, writeAtomic } from './jsonl'

const SAVE_DELAY_MS = 200

export class FileStore implements StorePort {
	readonly agentsDir: string
	readonly logsDir: string
	private readonly statePath: string
	private readonly msgPath: string
	private readonly rolesPath: string
	private saveTimer: NodeJS.Timeout | null = null
	private getState: (() => PersistedState) | null = null
	private closed = false

	constructor(readonly home: string) {
		this.agentsDir = path.join(home, 'agents')
		this.logsDir = path.join(home, 'logs')
		fs.mkdirSync(this.agentsDir, { recursive: true })
		fs.mkdirSync(this.logsDir, { recursive: true })
		this.statePath = path.join(home, 'state.json')
		this.msgPath = path.join(home, 'messages.jsonl')
		this.rolesPath = path.join(home, 'roles.json')
	}

	loadState(): PersistedState {
		const raw = parseJson(readText(this.statePath))
		if (!isObject(raw)) return { spaces: [], agents: [], msgSeq: 0, inboxCursor: 0 }
		return {
			spaces: arr(raw['spaces']) as PersistedSpace[],
			agents: arr(raw['agents']) as PersistedAgent[],
			msgSeq: typeof raw['msgSeq'] === 'number' ? raw['msgSeq'] : 0,
			inboxCursor: typeof raw['inboxCursor'] === 'number' ? raw['inboxCursor'] : 0,
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
		writeAtomic(this.statePath, JSON.stringify(this.getState(), null, 2))
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
		return list.filter(isRoleView)
	}

	saveRoles(roles: readonly RoleView[]): void {
		if (!this.closed) writeAtomic(this.rolesPath, JSON.stringify({ roles }, null, 2))
	}

	appendMessage(m: Message): void {
		if (!this.closed) appendJsonl(this.msgPath, m)
	}

	loadMessages(limit = 5000): Message[] {
		return readJsonl<Message>(this.msgPath, limit)
	}

	appendEvent(agentId: string, ev: AgentEvent): void {
		if (!this.closed) appendJsonl(this.eventsPath(agentId), ev)
	}

	readEvents(agentId: string, limit = 500): AgentEvent[] {
		return readJsonl<AgentEvent>(this.eventsPath(agentId), limit)
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
