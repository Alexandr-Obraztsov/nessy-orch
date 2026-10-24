/**
 * Общий тестовый харнесс команд CLI: мок-транспорт + вывод + базовые агентские объекты.
 * Вынесен отдельно, чтобы тесты команд (agents/feed/roles/sessions/spaces) не дублировали мок.
 */
import type { AgentView } from '../../shared/types'
import type { Transport } from '../../src/interfaces/cli/transport'

/** Базовый агент для стабов. */
export const baseAgent: AgentView = {
	id: 'a-1',
	name: 'a-1',
	title: null,
	space: 'ws',
	session: null,
	parent: 'you',
	role: null,
	status: 'idle',
	archived: false,
	parked: false,
	error: null,
	displayName: null,
	createdAt: '',
	lastActivityAt: '',
	queued: 0,
	turnStartedAt: null,
	lastTool: null,
	preview: '',
	pendingPermissions: [],
	plan: null,
	turnSteps: 0,
	lastTurnMs: null,
	lastReply: null,
	stats: { turns: 0, toolCalls: 0, workMs: 0, tokens: null, contextPct: null },
}

/** Агент с переопределениями. */
export function agent(over: Partial<AgentView>): AgentView {
	return { ...baseAgent, ...over }
}

/** Запись запроса: метод + путь + тело. */
export interface Req {
	method: string
	path: string
	body?: unknown
}

/** Мок HTTP-клиента: отвечает по правилам, накапливает запросы. */
export function mockTransport(routes: Record<string, (method: string, body?: unknown) => unknown>): {
	t: Transport
	calls: Req[]
	keys: (string | undefined)[]
} {
	const calls: Req[] = []
	const keys: (string | undefined)[] = []
	const t: Transport = {
		get<T>(path: string): Promise<T> {
			calls.push({ method: 'GET', path })
			const h = routes[path]
			return Promise.resolve(h ? (h('GET') as T) : (undefined as T))
		},
		post<T>(path: string, body?: unknown): Promise<T> {
			calls.push({ method: 'POST', path, body })
			const h = routes[path]
			return Promise.resolve(h ? (h('POST', body) as T) : (undefined as T))
		},
		put<T>(path: string, body?: unknown): Promise<T> {
			calls.push({ method: 'PUT', path, body })
			const h = routes[path]
			return Promise.resolve(h ? (h('PUT', body) as T) : (undefined as T))
		},
		patch<T>(path: string, body?: unknown): Promise<T> {
			calls.push({ method: 'PATCH', path, body })
			const h = routes[path]
			return Promise.resolve(h ? (h('PATCH', body) as T) : (undefined as T))
		},
		del(path: string): Promise<unknown> {
			calls.push({ method: 'DELETE', path })
			const h = routes[path]
			return Promise.resolve(h ? h('DELETE') : undefined)
		},
		setAgentKey(key?: string): void {
			keys.push(key)
		},
		sse(_path: string, _onData: (raw: unknown) => void) {
			return { done: Promise.resolve(), close: () => undefined }
		},
	}
	return { t, calls, keys }
}

/** Провайдер вывода: out — в stdout, info — в stderr. */
export function opts(): {
	cwd: string
	env: NodeJS.ProcessEnv
	out: (s: string) => void
	info: (s: string) => void
	stdout: string[]
	stderr: string[]
} {
	const stdout: string[] = []
	const stderr: string[] = []
	return {
		cwd: '/ws',
		env: {},
		out: (s: string) => stdout.push(s),
		info: (s: string) => stderr.push(s),
		stdout,
		stderr,
	}
}
