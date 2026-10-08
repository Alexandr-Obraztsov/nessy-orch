/**
 * Клиент HTTP API оркестратора. UI раздаётся тем же сервером, поэтому пути относительные
 * (в dev их проксирует Vite). Типы — общие с сервером (`shared/types.ts`).
 */
import type {
	AgentEvent,
	AgentView,
	ApiError,
	GraphView,
	Message,
	SendRequest,
	SendResponse,
	SpaceRequest,
	SpaceView,
	SpawnRequest,
	SpawnResponse,
	StatusResponse,
} from '@contract'

export class ApiFailure extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message)
	}
}

function isApiError(v: unknown): v is ApiError {
	return typeof v === 'object' && v !== null && 'error' in v && typeof v.error === 'string'
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	let res: Response
	try {
		res = await fetch(path, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
	} catch {
		throw new ApiFailure(0, 'offline', 'оркестратор недоступен')
	}
	const text = await res.text()
	let data: unknown = undefined
	if (text) {
		try {
			data = JSON.parse(text)
		} catch {
			data = undefined
		}
	}
	if (!res.ok) {
		if (isApiError(data)) throw new ApiFailure(res.status, data.code, data.error)
		throw new ApiFailure(res.status, 'http', `HTTP ${res.status}`)
	}
	return data as T
}

const enc = encodeURIComponent

export const api = {
	status: () => request<StatusResponse>('GET', '/status'),
	graph: () => request<GraphView>('GET', '/graph'),

	addSpace: (req: SpaceRequest) => request<SpaceView>('POST', '/spaces', req),
	removeSpace: (name: string, force = false) =>
		request<{ ok: boolean }>('DELETE', `/spaces/${enc(name)}${force ? '?force=1' : ''}`),

	spawn: (req: SpawnRequest) => request<SpawnResponse>('POST', '/agents', req),
	removeAgent: (id: string) => request<{ ok: boolean }>('DELETE', `/agents/${enc(id)}`),
	send: (id: string, req: SendRequest) => request<SendResponse>('POST', `/agents/${enc(id)}/send`, req),
	cancel: (id: string) => request<AgentView>('POST', `/agents/${enc(id)}/cancel`),
	permission: (id: string, requestId: string, approve: boolean) =>
		request<{ ok: boolean }>('POST', `/agents/${enc(id)}/permission/${enc(requestId)}`, { approve }),
	history: (id: string, limit = 400) => request<AgentEvent[]>('GET', `/agents/${enc(id)}/history?limit=${limit}`),

	messages: (opts: { agent?: string; since?: number; limit?: number } = {}) => {
		const q = new URLSearchParams()
		if (opts.agent) q.set('agent', opts.agent)
		if (opts.since !== undefined) q.set('since', String(opts.since))
		if (opts.limit !== undefined) q.set('limit', String(opts.limit))
		return request<Message[]>('GET', `/messages?${q.toString()}`)
	},
}

export function errorText(e: unknown): string {
	if (e instanceof ApiFailure) return e.message
	if (e instanceof Error) return e.message
	return String(e)
}
