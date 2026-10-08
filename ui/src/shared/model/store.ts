/**
 * Глобальное состояние UI: граф (пространства, агенты) и общая лента.
 * Источник — SSE `/stream` (снапшот + изменения). Переподключение с экспоненциальной паузой.
 * Подписка из React — через `useStore(selector)` (useSyncExternalStore).
 */
import { useSyncExternalStore } from 'react'
import type { AgentView, Message, RoleView, SpaceView, StreamEvent } from '@contract'
import type { MessageListener, State } from './types'

const MAX_MESSAGES = 2000

let state: State = {
	conn: 'connecting',
	rev: 0,
	spaces: [],
	agents: [],
	roles: [],
	messages: [],
	lastEventAt: 0,
}

const listeners = new Set<() => void>()

function set(patch: Partial<State>): void {
	state = { ...state, ...patch }
	for (const fn of listeners) fn()
}

export function getState(): State {
	return state
}

export function subscribe(fn: () => void): () => void {
	listeners.add(fn)
	return () => {
		listeners.delete(fn)
	}
}

export function useStore<T>(selector: (s: State) => T): T {
	return useSyncExternalStore(subscribe, () => selector(state))
}

/** Подписка на каждое новое сообщение ленты (анимация «пакета» по ребру графа, уведомления). */
const messageListeners = new Set<MessageListener>()
export function onMessage(fn: MessageListener): () => void {
	messageListeners.add(fn)
	return () => {
		messageListeners.delete(fn)
	}
}

function upsert<T>(list: T[], item: T, key: (x: T) => string): T[] {
	const k = key(item)
	const i = list.findIndex(x => key(x) === k)
	if (i === -1) return [...list, item]
	const next = list.slice()
	next[i] = item
	return next
}

function apply(evt: StreamEvent): void {
	const now = Date.now()
	switch (evt.t) {
		case 'snapshot':
			set({
				rev: evt.rev,
				spaces: evt.spaces,
				agents: evt.agents,
				roles: evt.roles,
				messages: evt.messages.slice(-MAX_MESSAGES),
				lastEventAt: now,
			})
			return
		case 'message': {
			const msgs = state.messages
			const last = msgs[msgs.length - 1]
			let next: Message[]
			if (!last || evt.message.seq > last.seq) next = [...msgs, evt.message]
			else next = upsert(msgs, evt.message, m => m.id).sort((a, b) => a.seq - b.seq)
			set({ rev: evt.rev, messages: next.slice(-MAX_MESSAGES), lastEventAt: now })
			for (const fn of messageListeners) fn(evt.message)
			return
		}
		case 'agent':
			set({ rev: evt.rev, agents: upsert(state.agents, evt.agent, a => a.id), lastEventAt: now })
			return
		case 'agent_removed':
			set({ rev: evt.rev, agents: state.agents.filter(a => a.id !== evt.id), lastEventAt: now })
			return
		case 'space':
			set({ rev: evt.rev, spaces: upsert(state.spaces, evt.space, s => s.name), lastEventAt: now })
			return
		case 'role':
			set({ rev: evt.rev, roles: upsert(state.roles, evt.role, r => r.id), lastEventAt: now })
			return
		case 'role_removed':
			set({ rev: evt.rev, roles: state.roles.filter(r => r.id !== evt.id), lastEventAt: now })
			return
		case 'space_removed':
			set({ rev: evt.rev, spaces: state.spaces.filter(s => s.name !== evt.name), lastEventAt: now })
			return
	}
}

let es: EventSource | null = null
let retry = 0
let retryTimer: number | undefined

export function connect(): void {
	if (es) return
	set({ conn: 'connecting' })
	const src = new EventSource('/stream')
	es = src
	src.onopen = () => {
		retry = 0
	}
	src.onmessage = e => {
		try {
			const evt = JSON.parse(String(e.data)) as StreamEvent
			if (evt.t === 'snapshot') set({ conn: 'live' })
			apply(evt)
		} catch {
			/* битый кадр — пропускаем */
		}
	}
	src.onerror = () => {
		// закрываем сами: после переподключения сервер пришлёт свежий снапшот
		src.close()
		es = null
		set({ conn: 'offline' })
		const delay = Math.min(15000, 500 * 2 ** retry++)
		window.clearTimeout(retryTimer)
		retryTimer = window.setTimeout(connect, delay)
	}
}

export function reconnectNow(): void {
	window.clearTimeout(retryTimer)
	es?.close()
	es = null
	retry = 0
	connect()
}

// ---------- селекторы / хелперы ----------
export const YOU = 'you'

export function agentById(id: string): AgentView | undefined {
	return state.agents.find(a => a.id === id)
}

export function roleById(id: string | null): RoleView | undefined {
	return id ? state.roles.find(r => r.id === id) : undefined
}

export function spaceHue(spaces: SpaceView[], name: string): number {
	return spaces.find(s => s.name === name)?.color ?? 170
}

/** Подпись узла для ленты: имя агента или «Вы». */
export function nodeLabel(agents: AgentView[], id: string): string {
	if (id === YOU) return 'Вы'
	if (id === 'system') return 'система'
	const a = agents.find(x => x.id === id)
	return a ? a.name : id
}
